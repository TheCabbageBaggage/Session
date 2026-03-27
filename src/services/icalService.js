'use strict';

/**
 * iCal generation service – RFC 5545 compliant VCALENDAR/VEVENT strings.
 *
 * All times are treated as local wall-clock (the app runs in a single-location
 * context), expressed without timezone suffix using DTSTART;TZID= if a zone
 * is configured, or as floating time otherwise. For simplicity we use UTC
 * by appending the times to the UTC date stamp.
 */

/**
 * Fold long lines per RFC 5545 §3.1 (max 75 octets, continuation with CRLF + SPACE).
 */
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let pos = 0;
  let first = true;
  while (pos < bytes.length) {
    const limit = first ? 75 : 74; // first line 75, continuation has leading space
    const chunk = bytes.slice(pos, pos + limit);
    parts.push((first ? '' : ' ') + chunk.toString('utf8'));
    pos += limit;
    first = false;
  }
  return parts.join('\r\n');
}

/**
 * Escape special characters in iCal text values.
 */
function escapeText(str) {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Convert a date + time string "HH:MM" to an iCal DATETIME string (UTC naive).
 * date: JS Date object (midnight UTC) or ISO string
 * time: "HH:MM"
 */
function toIcalDt(date, time) {
  const d = new Date(date);
  const [h, m] = time.split(':').map(Number);
  d.setUTCHours(h, m, 0, 0);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Generate a VCALENDAR string for a single booking.
 *
 * @param {object} booking  – full booking object (with room, user, attendees)
 * @param {'REQUEST'|'CANCEL'|'REPLY'} method
 * @param {number} sequence – increment for updates (0=new, 1=first update, …)
 * @param {object} [opts]   – { organizerEmail, organizerName }
 */
function generateBookingIcal(booking, method = 'REQUEST', sequence = 0, opts = {}) {
  const uid = `booking-${booking.id}@session`;
  const dtstamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const dtstart = toIcalDt(booking.date, booking.startTime);
  const dtend   = toIcalDt(booking.date, booking.endTime);

  const status = method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED';
  const summary = escapeText(booking.title || (booking.room ? booking.room.name : 'Room Booking'));
  const location = booking.room ? escapeText(booking.room.name + (booking.room.location ? `, ${booking.room.location}` : '')) : '';

  const descParts = [];
  if (booking.attendeeCount) descParts.push(`Attendees: ${booking.attendeeCount}`);
  if (booking.company)       descParts.push(`Company: ${booking.company}`);
  if (booking.costCentre)    descParts.push(`Cost Centre: ${booking.costCentre}`);
  if (booking.notes)         descParts.push(`Notes: ${booking.notes}`);
  const description = escapeText(descParts.join('\\n'));

  const organizer = opts.organizerEmail
    ? `ORGANIZER;CN="${escapeText(opts.organizerName || 'Session')}":MAILTO:${opts.organizerEmail}`
    : `ORGANIZER;CN="Session Room Booking":MAILTO:noreply@session.local`;

  const attendeeLines = (booking.attendees || [])
    .map(a => fold(`ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;RSVP=TRUE:MAILTO:${a.email}`))
    .join('\r\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Session//Room Booking System//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    fold(`UID:${uid}`),
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    fold(`SUMMARY:${summary}`),
    location ? fold(`LOCATION:${location}`) : null,
    description ? fold(`DESCRIPTION:${description}`) : null,
    organizer,
    attendeeLines || null,
    `STATUS:${status}`,
    `SEQUENCE:${sequence}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');

  return lines + '\r\n';
}

/**
 * Generate a VCALENDAR for a recurring series booking.
 * Each occurrence is sent individually, but the UID includes the series ID
 * so calendars can group them.
 */
function generateSeriesOccurrenceIcal(booking, seriesId, method = 'REQUEST', sequence = 0, opts = {}) {
  // Use a series-scoped UID for grouping
  const uid = `series-${seriesId}-occurrence-${booking.id}@session`;
  return generateBookingIcal({ ...booking }, method, sequence, opts)
    .replace(/^UID:.*$/m, fold(`UID:${uid}`));
}

module.exports = { generateBookingIcal, generateSeriesOccurrenceIcal, toIcalDt };
