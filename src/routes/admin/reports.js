'use strict';

const express = require('express');
const router  = express.Router();
const { requireAuth, requireAdmin } = require('../../middleware/auth');
const reportService = require('../../services/reportService');

router.use(requireAuth, requireAdmin);

// ---------------------------------------------------------------------------
// Default date range helpers
// ---------------------------------------------------------------------------

function defaultRange() {
  const now   = new Date();
  const start = reportService.startOfMonth(now).toISOString().slice(0, 10);
  const end   = reportService.endOfMonth(now).toISOString().slice(0, 10);
  return { start, end };
}

// ---------------------------------------------------------------------------
// Reports index page
// ---------------------------------------------------------------------------

router.get('/', (req, res) => res.redirect('/admin/reports/cost-centre'));

router.get('/cost-centre', async (req, res, next) => {
  try {
    const { start, end } = { ...defaultRange(), ...req.query };
    const data = await reportService.getBookingsByCostCentre({ startDate: start, endDate: end });
    res.render('admin/reports', {
      title:      req.t('admin.reports'),
      reportType: 'cost-centre',
      start, end, data,
    });
  } catch (err) { next(err); }
});

router.get('/rooms', async (req, res, next) => {
  try {
    const { start, end } = { ...defaultRange(), ...req.query };
    const data = await reportService.getBookingsByRoom({ startDate: start, endDate: end });
    res.render('admin/reports', {
      title:      req.t('admin.reports'),
      reportType: 'rooms',
      start, end, data,
    });
  } catch (err) { next(err); }
});

router.get('/utilisation', async (req, res, next) => {
  try {
    const { start, end } = { ...defaultRange(), ...req.query };
    const data = await reportService.getRoomUtilisation({ startDate: start, endDate: end });
    res.render('admin/reports', {
      title:      req.t('admin.reports'),
      reportType: 'utilisation',
      start, end, data,
    });
  } catch (err) { next(err); }
});

router.get('/catering', async (req, res, next) => {
  try {
    const { start, end } = { ...defaultRange(), ...req.query };
    const data = await reportService.getCateringQuantities({ startDate: start, endDate: end });
    res.render('admin/reports', {
      title:      req.t('admin.reports'),
      reportType: 'catering',
      start, end, data,
    });
  } catch (err) { next(err); }
});

router.get('/company', async (req, res, next) => {
  try {
    const { start, end } = { ...defaultRange(), ...req.query };
    const data = await reportService.getBookingsByCompany({ startDate: start, endDate: end });
    res.render('admin/reports', {
      title:      req.t('admin.reports'),
      reportType: 'company',
      start, end, data,
    });
  } catch (err) { next(err); }
});

router.get('/cancelled', async (req, res, next) => {
  try {
    const { start, end } = { ...defaultRange(), ...req.query };
    const data = await reportService.getCancelledBookings({ startDate: start, endDate: end });
    res.render('admin/reports', {
      title:      req.t('admin.reports'),
      reportType: 'cancelled',
      start, end, data,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

function escCsv(v) {
  if (v == null) return '';
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsvRows(headers, rows) {
  return [headers.join(','), ...rows.map(r => r.map(escCsv).join(','))].join('\r\n');
}

router.get('/export/csv', async (req, res, next) => {
  try {
    const { type, start, end } = req.query;
    const { start: ds, end: de } = { ...defaultRange(), ...(start && end ? { start, end } : {}) };
    let csv = '';
    let filename = `report-${type}-${ds}-${de}.csv`;

    if (type === 'cost-centre') {
      const data = await reportService.getBookingsByCostCentre({ startDate: ds, endDate: de });
      csv = toCsvRows(['Cost Centre', 'Bookings'], data.map(r => [r.costCentre, r.count]));
    } else if (type === 'rooms') {
      const data = await reportService.getBookingsByRoom({ startDate: ds, endDate: de });
      csv = toCsvRows(['Room', 'Bookings', 'Total Minutes'], data.map(r => [r.roomName, r.count, r.totalMinutes]));
    } else if (type === 'utilisation') {
      const data = await reportService.getRoomUtilisation({ startDate: ds, endDate: de });
      csv = toCsvRows(['Room', 'Location', 'Capacity', 'Booked (min)', 'Available (min)', 'Utilisation %'],
        data.map(r => [r.roomName, r.location, r.capacity, r.totalMinutes, r.availableMinutes, r.utilisationPct]));
    } else if (type === 'catering') {
      const data = await reportService.getCateringQuantities({ startDate: ds, endDate: de });
      csv = toCsvRows(['Catering Option', 'Quantity'], data.map(r => [r.option, r.quantity]));
    } else if (type === 'company') {
      const data = await reportService.getBookingsByCompany({ startDate: ds, endDate: de });
      csv = toCsvRows(['Company', 'Bookings'], data.map(r => [r.company, r.count]));
    } else if (type === 'cancelled') {
      const data = await reportService.getCancelledBookings({ startDate: ds, endDate: de });
      csv = toCsvRows(['Date', 'Room', 'Booked By', 'Title'],
        data.map(r => [
          r.date.toISOString().slice(0, 10),
          r.room ? r.room.name : '',
          r.user ? `${r.user.firstName} ${r.user.lastName}` : '',
          r.title || '',
        ]));
    } else {
      return res.status(400).send('Unknown report type');
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv); // UTF-8 BOM for Excel compatibility
  } catch (err) { next(err); }
});

module.exports = router;
