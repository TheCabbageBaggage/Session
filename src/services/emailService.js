'use strict';

/**
 * Email service – Nodemailer-based transactional emails with iCal attachments.
 *
 * Supports:
 *  - INVITATION  (METHOD:REQUEST)  – booking created
 *  - UPDATE      (METHOD:REQUEST)  – booking updated, sequence++
 *  - CANCELLATION (METHOD:CANCEL)  – booking cancelled
 *
 * Language is resolved from the booking creator's user profile, falling back to 'en'.
 * All sends are logged to the EmailLog table.
 */

const nodemailer = require('nodemailer');
const crypto = require('crypto');
const config = require('../config');
const prisma = require('../db/prisma');
const logger = require('../logger');
const { generateBookingIcal, generateSeriesOccurrenceIcal } = require('./icalService');

// ---------------------------------------------------------------------------
// Config / Encryption helpers
// ---------------------------------------------------------------------------

function decryptPassword(encrypted) {
  if (!encrypted || !encrypted.startsWith('ENCRYPTED:')) return encrypted;
  const key = process.env.CONFIG_ENCRYPTION_KEY || '0'.repeat(32);
  const keyBuf = Buffer.from(key.padEnd(32).slice(0, 32), 'utf8');
  const payload = Buffer.from(encrypted.slice(10), 'hex');
  const iv  = payload.slice(0, 16);
  const enc = payload.slice(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuf, iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

let _transporter = null;
let _transporterCfgHash = null;

function getTransporter() {
  const smtpCfg = config.smtp();
  const hash = JSON.stringify(smtpCfg);
  if (_transporter && hash === _transporterCfgHash) return _transporter;

  const password = decryptPassword(smtpCfg.auth && smtpCfg.auth.password);

  _transporter = nodemailer.createTransport({
    host: smtpCfg.host,
    port: smtpCfg.port || 587,
    secure: smtpCfg.secure || false,
    auth: smtpCfg.auth ? { user: smtpCfg.auth.user, pass: password } : undefined,
    tls: smtpCfg.tls || { rejectUnauthorized: false },
  });
  _transporterCfgHash = hash;
  return _transporter;
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

function formatDate(dateVal) {
  const d = new Date(dateVal);
  return d.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function formatDateDe(dateVal) {
  const d = new Date(dateVal);
  return d.toLocaleDateString('de-DE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function buildSubject(type, booking, lang) {
  const roomName = booking.room ? booking.room.name : 'Room';
  const title    = booking.title || roomName;
  if (lang === 'de') {
    const prefixes = { INVITATION: 'Buchungsbestätigung', UPDATE: 'Buchungsänderung', CANCELLATION: 'Buchungsstornierung' };
    return `${prefixes[type] || 'Buchung'}: ${title}`;
  }
  const prefixes = { INVITATION: 'Booking Confirmation', UPDATE: 'Booking Updated', CANCELLATION: 'Booking Cancelled' };
  return `${prefixes[type] || 'Booking'}: ${title}`;
}

function buildHtmlBody(type, booking, lang) {
  const de = lang === 'de';
  const dateStr = de ? formatDateDe(booking.date) : formatDate(booking.date);
  const roomName = booking.room ? booking.room.name : '–';
  const location = booking.room && booking.room.location ? ` (${booking.room.location})` : '';
  const title    = booking.title || (de ? 'Raumreservierung' : 'Room Booking');

  const colors = { INVITATION: '#2563eb', UPDATE: '#d97706', CANCELLATION: '#dc2626' };
  const bannerColor = colors[type] || '#2563eb';

  const bannerTextEn = { INVITATION: 'Booking Confirmed', UPDATE: 'Booking Updated', CANCELLATION: 'Booking Cancelled' };
  const bannerTextDe = { INVITATION: 'Buchung bestätigt', UPDATE: 'Buchung geändert', CANCELLATION: 'Buchung storniert' };
  const bannerText   = de ? (bannerTextDe[type] || 'Buchung') : (bannerTextEn[type] || 'Booking');

  const statusNote = type === 'CANCELLATION'
    ? `<p style="color:#dc2626;font-weight:bold;">${de ? 'Diese Buchung wurde storniert.' : 'This booking has been cancelled.'}</p>`
    : '';

  const cateringRows = booking.catering && booking.catering.length > 0
    ? `<tr><td style="padding:4px 0;color:#6b7280;">${de ? 'Catering' : 'Catering'}:</td>
       <td style="padding:4px 8px;">${booking.catering.map(c => `${c.cateringOption} × ${c.quantity}`).join(', ')}</td></tr>`
    : '';

  const attendeeNote = booking.attendees && booking.attendees.length > 0
    ? `<p style="margin-top:12px;font-size:13px;color:#6b7280;">
        ${de ? 'Eingeladene Teilnehmer' : 'Invited attendees'}:
        ${booking.attendees.map(a => a.email).join(', ')}
       </p>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;background:#f3f4f6;margin:0;padding:20px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.1);">
  <div style="background:${bannerColor};color:#fff;padding:20px 24px;">
    <h1 style="margin:0;font-size:20px;">${bannerText}</h1>
    <p style="margin:4px 0 0;opacity:.85;font-size:14px;">Session ${de ? 'Raumbuchungssystem' : 'Room Booking System'}</p>
  </div>
  <div style="padding:24px;">
    ${statusNote}
    <h2 style="margin:0 0 16px;font-size:18px;color:#111827;">${title}</h2>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:4px 0;color:#6b7280;width:140px;">${de ? 'Raum' : 'Room'}:</td>
          <td style="padding:4px 8px;font-weight:bold;">${roomName}${location}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280;">${de ? 'Datum' : 'Date'}:</td>
          <td style="padding:4px 8px;">${dateStr}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280;">${de ? 'Uhrzeit' : 'Time'}:</td>
          <td style="padding:4px 8px;font-weight:bold;">${booking.startTime} – ${booking.endTime}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280;">${de ? 'Teilnehmer' : 'Attendees'}:</td>
          <td style="padding:4px 8px;">${booking.attendeeCount || 1}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280;">${de ? 'Unternehmen' : 'Company'}:</td>
          <td style="padding:4px 8px;">${booking.company || '–'}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280;">${de ? 'Kostenstelle' : 'Cost Centre'}:</td>
          <td style="padding:4px 8px;">${booking.costCentre || '–'}</td></tr>
      ${cateringRows}
      ${booking.notes ? `<tr><td style="padding:4px 0;color:#6b7280;">${de ? 'Anmerkungen' : 'Notes'}:</td>
          <td style="padding:4px 8px;">${booking.notes}</td></tr>` : ''}
    </table>
    ${attendeeNote}
    <p style="margin-top:24px;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:12px;">
      ${de ? 'Diese Nachricht wurde automatisch vom Session Raumbuchungssystem gesendet.' :
             'This message was sent automatically by the Session Room Booking System.'}
    </p>
  </div>
</div>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Core send function
// ---------------------------------------------------------------------------

/**
 * Send an email for a booking event.
 *
 * @param {object} booking   – full booking with room, user, attendees, catering
 * @param {'INVITATION'|'UPDATE'|'CANCELLATION'} type
 * @param {object} [options]
 * @param {string} [options.language]      – 'en' | 'de'
 * @param {number} [options.sequence]      – iCal SEQUENCE number (0=new)
 * @param {boolean} [options.isSeriesOccurrence]
 * @param {number}  [options.seriesId]
 */
async function sendBookingEmail(booking, type, options = {}) {
  const smtpCfg = config.smtp();
  if (!smtpCfg || !smtpCfg.host || smtpCfg.host === 'smtp.example.com') {
    logger.info('SMTP not configured – skipping email', { bookingId: booking.id, type });
    return { skipped: true };
  }

  const lang      = options.language || 'en';
  const sequence  = options.sequence || 0;
  const method    = type === 'CANCELLATION' ? 'CANCEL' : 'REQUEST';

  // Resolve recipient list: booking user + attendee emails
  const recipients = new Set();
  if (booking.user && booking.user.email) recipients.add(booking.user.email);
  if (booking.attendees) booking.attendees.forEach(a => a.email && recipients.add(a.email));

  if (recipients.size === 0) {
    logger.warn('No recipients for booking email', { bookingId: booking.id });
    return { skipped: true };
  }

  const icalContent = options.isSeriesOccurrence && options.seriesId
    ? generateSeriesOccurrenceIcal(booking, options.seriesId, method, sequence, { organizerEmail: smtpCfg.from && smtpCfg.from.address, organizerName: smtpCfg.from && smtpCfg.from.name })
    : generateBookingIcal(booking, method, sequence, { organizerEmail: smtpCfg.from && smtpCfg.from.address, organizerName: smtpCfg.from && smtpCfg.from.name });

  const subject  = buildSubject(type, booking, lang);
  const htmlBody = buildHtmlBody(type, booking, lang);
  const from     = smtpCfg.from
    ? `"${smtpCfg.from.name}" <${smtpCfg.from.address}>`
    : 'Session Room Booking <noreply@session.local>';

  const mailOptions = {
    from,
    to: [...recipients].join(', '),
    replyTo: smtpCfg.replyTo || undefined,
    subject,
    html: htmlBody,
    attachments: [{
      filename: `booking-${booking.id}.ics`,
      content: icalContent,
      contentType: `text/calendar; method=${method}; charset=UTF-8`,
    }],
  };

  let status = 'SENT';
  let errorMessage = null;
  let sentAt = null;

  try {
    const transporter = getTransporter();
    await transporter.sendMail(mailOptions);
    sentAt = new Date();
    logger.info('Booking email sent', { bookingId: booking.id, type, recipients: [...recipients] });
  } catch (err) {
    status = 'FAILED';
    errorMessage = err.message;
    logger.error('Booking email failed', { bookingId: booking.id, type, error: err.message });
  }

  // Log each recipient
  for (const recipient of recipients) {
    await prisma.emailLog.create({
      data: {
        bookingId: booking.id,
        recipient,
        subject,
        type,
        status,
        errorMessage,
        sentAt,
      },
    }).catch(e => logger.error('Failed to write email log', { error: e.message }));
  }

  return { status, recipients: [...recipients] };
}

/**
 * Send a test email to verify SMTP configuration.
 */
async function sendTestEmail(toAddress) {
  const smtpCfg = config.smtp();
  const from = smtpCfg.from
    ? `"${smtpCfg.from.name}" <${smtpCfg.from.address}>`
    : 'Session Room Booking <noreply@session.local>';

  const transporter = getTransporter();
  await transporter.sendMail({
    from,
    to: toAddress,
    subject: 'Session – SMTP Test',
    text: 'This is a test email from the Session Room Booking System. If you received this, your SMTP configuration is working correctly.',
  });
}

module.exports = { sendBookingEmail, sendTestEmail };
