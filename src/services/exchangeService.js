'use strict';

/**
 * Exchange Synchronisation Service
 *
 * Supports two modes (configured via exchange.config.json):
 *   mode: "graph"  – Microsoft Graph API (OAuth2 client credentials)
 *   mode: "ews"    – Exchange Web Services (SOAP / Basic Auth)
 *   mode: null     – disabled (no-op)
 *
 * Every sync attempt is logged to the ExchangeSyncLog table.
 */

const prisma = require('../db/prisma');
const logger = require('../logger');

function getConfig() {
  // Lazy-require to pick up config reloads
  const config = require('../config');
  return config.exchange ? config.exchange() : {};
}

function isEnabled() {
  const cfg = getConfig();
  return !!(cfg && cfg.mode && cfg.mode !== 'disabled');
}

// ---------------------------------------------------------------------------
// Microsoft Graph API helpers
// ---------------------------------------------------------------------------

let _graphTokenCache = null;

async function getGraphToken(cfg) {
  if (_graphTokenCache && _graphTokenCache.expiresAt > Date.now() + 60_000) {
    return _graphTokenCache.token;
  }
  const url = `https://login.microsoftonline.com/${cfg.graph.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id:     cfg.graph.clientId,
    client_secret: cfg.graph.clientSecret,
    scope:         'https://graph.microsoft.com/.default',
    grant_type:    'client_credentials',
  });
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Graph OAuth2 failed: ${resp.status} ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  _graphTokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return _graphTokenCache.token;
}

function toGraphEvent(booking) {
  const dateStr  = booking.date.toISOString().slice(0, 10);
  const bodyText = [
    booking.user ? `Booked by: ${booking.user.firstName} ${booking.user.lastName}` : null,
    booking.costCentre ? `Cost Centre: ${booking.costCentre}` : null,
    booking.company    ? `Company: ${booking.company}` : null,
    booking.notes      ? `Notes: ${booking.notes}` : null,
  ].filter(Boolean).join('\n');

  return {
    subject: booking.title || `Room Booking #${booking.id}`,
    start:   { dateTime: `${dateStr}T${booking.startTime}:00`, timeZone: 'UTC' },
    end:     { dateTime: `${dateStr}T${booking.endTime}:00`,   timeZone: 'UTC' },
    body:    { contentType: 'text', content: bodyText },
    attendees: (booking.attendees || []).map(a => ({
      emailAddress: { address: a.email },
      type: 'required',
    })),
    showAs:           'busy',
    isReminderOn:     false,
    isOnlineMeeting:  false,
  };
}

async function graphCreate(mailbox, booking, token) {
  const url  = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/events`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(toGraphEvent(booking)),
  });
  if (!resp.ok) throw new Error(`Graph createEvent ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  return (await resp.json()).id;
}

async function graphUpdate(mailbox, externalId, booking, token) {
  const url  = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/events/${externalId}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(toGraphEvent(booking)),
  });
  if (!resp.ok) throw new Error(`Graph updateEvent ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
}

async function graphDelete(mailbox, externalId, token) {
  const url  = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/events/${externalId}`;
  const resp = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`Graph deleteEvent ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// EWS (Exchange Web Services) SOAP helpers
// ---------------------------------------------------------------------------

function escapeXml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ewsDt(date, time) {
  return `${date.toISOString().slice(0, 10)}T${time}:00Z`;
}

function ewsCreateSoap(booking) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"
               xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
  <soap:Body>
    <m:CreateItem SendMeetingInvitations="SendToNone">
      <m:SavedItemFolderId><t:DistinguishedFolderId Id="calendar"/></m:SavedItemFolderId>
      <m:Items>
        <t:CalendarItem>
          <t:Subject>${escapeXml(booking.title || `Room Booking #${booking.id}`)}</t:Subject>
          <t:Start>${ewsDt(booking.date, booking.startTime)}</t:Start>
          <t:End>${ewsDt(booking.date, booking.endTime)}</t:End>
          <t:LegacyFreeBusyStatus>Busy</t:LegacyFreeBusyStatus>
        </t:CalendarItem>
      </m:Items>
    </m:CreateItem>
  </soap:Body>
</soap:Envelope>`;
}

function ewsDeleteSoap(externalId) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"
               xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
  <soap:Body>
    <m:DeleteItem DeleteType="MoveToDeletedItems" SendMeetingCancellations="SendToNone">
      <m:ItemIds><t:ItemId Id="${escapeXml(externalId)}"/></m:ItemIds>
    </m:DeleteItem>
  </soap:Body>
</soap:Envelope>`;
}

async function ewsRequest(cfg, soap, mailbox) {
  const auth = Buffer.from(`${cfg.ews.username}:${cfg.ews.password}`).toString('base64');
  const resp = await fetch(cfg.ews.url, {
    method: 'POST',
    headers: {
      Authorization:    `Basic ${auth}`,
      'Content-Type':   'text/xml; charset=utf-8',
      SOAPAction:       '"http://schemas.microsoft.com/exchange/services/2006/messages/CreateItem"',
      'X-AnchorMailbox': mailbox,
    },
    body: soap,
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`EWS ${resp.status}: ${text.slice(0, 200)}`);
  const match = text.match(/ItemId Id="([^"]+)"/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sync a single booking to Exchange / Graph.
 * @param {number} bookingId
 * @param {'CREATE'|'UPDATE'|'CANCEL'} operation
 */
async function syncBooking(bookingId, operation) {
  if (!isEnabled()) return;

  const booking = await prisma.booking.findUnique({
    where: { id: Number(bookingId) },
    include: {
      room:      true,
      user:      { select: { firstName: true, lastName: true, email: true } },
      attendees: true,
    },
  });
  if (!booking) return;

  const mailbox = booking.room && booking.room.exchangeMailbox;
  if (!mailbox) return;

  const cfg        = getConfig();
  let externalId   = booking.exchangeEventId || null;

  const logEntry = await prisma.exchangeSyncLog.create({
    data: { bookingId: booking.id, operation, status: 'PENDING', attempts: 1 },
  });

  try {
    if (cfg.mode === 'graph') {
      const token = await getGraphToken(cfg);
      if (operation === 'CREATE') {
        externalId = await graphCreate(mailbox, booking, token);
      } else if (operation === 'UPDATE') {
        if (externalId) {
          await graphUpdate(mailbox, externalId, booking, token);
        } else {
          externalId = await graphCreate(mailbox, booking, token);
        }
      } else if (operation === 'CANCEL') {
        if (externalId) await graphDelete(mailbox, externalId, token);
      }
    } else if (cfg.mode === 'ews') {
      if (operation === 'CREATE') {
        externalId = await ewsRequest(cfg, ewsCreateSoap(booking), mailbox);
      } else if (operation === 'UPDATE') {
        if (externalId) {
          try {
            await ewsRequest(cfg, ewsDeleteSoap(externalId), mailbox);
          } catch (cleanupError) {
            logger.warn('EWS cleanup before update failed', {
              bookingId,
              externalId,
              message: cleanupError.message,
            });
          }
        }
        externalId = await ewsRequest(cfg, ewsCreateSoap(booking), mailbox);
      } else if (operation === 'CANCEL') {
        if (externalId) await ewsRequest(cfg, ewsDeleteSoap(externalId), mailbox);
      }
    }

    if (externalId && operation !== 'CANCEL') {
      await prisma.booking.update({
        where: { id: booking.id },
        data:  { exchangeEventId: externalId },
      });
    }

    await prisma.exchangeSyncLog.update({
      where: { id: logEntry.id },
      data:  { status: 'SUCCESS', lastAttempt: new Date() },
    });

    logger.info('Exchange sync success', { bookingId, operation, mailbox });
  } catch (err) {
    await prisma.exchangeSyncLog.update({
      where: { id: logEntry.id },
      data:  { status: 'FAILED', errorMessage: err.message, lastAttempt: new Date() },
    });
    logger.error('Exchange sync failed', { bookingId, operation, error: err.message });
    throw err;
  }
}

/**
 * Retry all FAILED sync operations that have fewer than 5 attempts.
 */
async function retryFailed() {
  if (!isEnabled()) return { retried: 0 };

  const failed = await prisma.exchangeSyncLog.findMany({
    where:   { status: 'FAILED', attempts: { lt: 5 } },
    orderBy: { createdAt: 'asc' },
    take:    20,
  });

  let retried = 0;
  for (const log of failed) {
    await prisma.exchangeSyncLog.update({
      where: { id: log.id },
      data:  { status: 'RETRY', attempts: { increment: 1 }, lastAttempt: new Date() },
    });
    try {
      await syncBooking(log.bookingId, log.operation);
      retried++;
    } catch {
      // syncBooking already logged the error
    }
  }
  return { retried };
}

module.exports = { syncBooking, retryFailed, isEnabled };
