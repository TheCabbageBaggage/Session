'use strict';

/**
 * Unit tests for icalService – pure functions, no mocking needed.
 */

const icalService = require('../../src/services/icalService');

describe('icalService', () => {

  describe('fold', () => {
    it('does not fold short lines', () => {
      const line   = 'SUMMARY:Short meeting';
      const result = icalService.fold(line);
      expect(result).toBe('SUMMARY:Short meeting');
    });

    it('folds a line longer than 75 octets with CRLF+SPACE continuation', () => {
      const long   = 'DESCRIPTION:' + 'A'.repeat(70);
      const folded = icalService.fold(long);
      // At minimum one fold should have occurred
      expect(folded).toContain('\r\n ');
      // First segment must be ≤75 octets
      const firstSegment = folded.split('\r\n ')[0];
      expect(Buffer.byteLength(firstSegment, 'utf8')).toBeLessThanOrEqual(75);
    });

    it('produces output that can be parsed back to the original ASCII content', () => {
      const line  = 'SUMMARY:' + 'Hello World Meeting - 12345 Agenda '.repeat(3);
      const folded = icalService.fold(line);
      const reconstituted = folded.replace(/\r\n /g, '');
      expect(reconstituted).toBe(line);
    });
  });

  describe('escapeText', () => {
    it('escapes backslash, semicolons, commas, and newlines', () => {
      const raw = 'a\\b;c,d\ne';
      const esc = icalService.escapeText(raw);
      expect(esc).toContain('\\\\');
      expect(esc).toContain('\\;');
      expect(esc).toContain('\\,');
      expect(esc).toContain('\\n');
    });

    it('returns empty string for null/undefined input', () => {
      expect(icalService.escapeText(null)).toBe('');
      expect(icalService.escapeText(undefined)).toBe('');
    });

    it('does not modify clean strings', () => {
      expect(icalService.escapeText('Hello World')).toBe('Hello World');
    });
  });

  describe('generateBookingIcal', () => {
    const booking = {
      id:           42,
      title:        'Team Standup',
      date:         new Date('2026-04-15T00:00:00.000Z'),
      startTime:    '09:00',
      endTime:      '09:30',
      notes:        'Daily sync',
      costCentre:   'IT-001',
      room:         { name: 'Boardroom' },
      user:         { firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' },
      attendees:    [{ email: 'bob@example.com' }, { email: 'carol@example.com' }],
    };

    it('produces a valid VCALENDAR wrapper with METHOD:REQUEST', () => {
      const ical = icalService.generateBookingIcal(booking, 'REQUEST', 0);
      expect(ical).toMatch(/BEGIN:VCALENDAR/);
      expect(ical).toMatch(/END:VCALENDAR/);
      expect(ical).toMatch(/METHOD:REQUEST/);
      expect(ical).toMatch(/BEGIN:VEVENT/);
      expect(ical).toMatch(/END:VEVENT/);
    });

    it('produces METHOD:CANCEL for cancellation', () => {
      const ical = icalService.generateBookingIcal(booking, 'CANCEL', 2);
      expect(ical).toMatch(/METHOD:CANCEL/);
      expect(ical).toMatch(/STATUS:CANCELLED/);
    });

    it('includes DTSTART, DTEND, SUMMARY, and UID', () => {
      const ical = icalService.generateBookingIcal(booking, 'REQUEST', 0);
      expect(ical).toMatch(/DTSTART:/);
      expect(ical).toMatch(/DTEND:/);
      expect(ical).toMatch(/SUMMARY:Team Standup/);
      expect(ical).toMatch(/UID:booking-42@session/);
    });

    it('includes all attendee email addresses (possibly line-folded)', () => {
      const ical = icalService.generateBookingIcal(booking, 'REQUEST', 0);
      // Line-folded content: remove CRLF+space continuations before matching
      const unfolded = ical.replace(/\r\n /g, '');
      expect(unfolded).toMatch(/ATTENDEE.*MAILTO:bob@example\.com/);
      expect(unfolded).toMatch(/ATTENDEE.*MAILTO:carol@example\.com/);
    });

    it('encodes the date correctly as YYYYMMDDTHHMMSSZ', () => {
      const ical = icalService.generateBookingIcal(booking, 'REQUEST', 0);
      expect(ical).toMatch(/20260415T090000Z/);
      expect(ical).toMatch(/20260415T093000Z/);
    });

    it('includes an ORGANIZER property', () => {
      const ical = icalService.generateBookingIcal(booking, 'REQUEST', 0);
      expect(ical).toMatch(/ORGANIZER/);
      // Organizer uses a configured system address (not user email)
      expect(ical).toMatch(/MAILTO:/);
    });

    it('sets SEQUENCE to the provided value', () => {
      const ical = icalService.generateBookingIcal(booking, 'REQUEST', 3);
      expect(ical).toMatch(/SEQUENCE:3/);
    });
  });

});
