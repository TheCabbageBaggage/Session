# Session – Room Booking System: Project Plan & Todo

**Project:** Session v2.1
**Total Duration:** 24 weeks (~6 months)
**Start Date:** 2026-03-27

---

## Milestone Overview

| # | Milestone | Weeks | Target Date |
|---|---|---|---|
| M1 | Project Setup & Architecture | Wk 1–3 | 2026-04-17 |
| M2 | Authentication & User Management | Wk 4–7 | 2026-05-15 |
| M3 | Core Booking & Room Management | Wk 8–12 | 2026-06-19 |
| M4 | Recurring Appointments, Email & iCal | Wk 13–17 | 2026-07-24 |
| M5 | Exchange Synchronisation & Reporting | Wk 18–21 | 2026-08-21 |
| M6 | Testing, Hardening & Go-Live | Wk 22–24 | 2026-09-11 |

---

## M1 – Project Setup & Architecture (Weeks 1–3)

**Goal:** Development environment, database schema, project skeleton for backend and frontend.

- [x] Define and document tech stack, project structure, and coding standards
- [ ] Set up development, staging, and production environments (Docker Compose)
- [x] Design and implement the full database schema (ERD) with migration scripts
- [x] Bootstrap REST API skeleton (health endpoint, base routing, error handling middleware)
- [x] Bootstrap frontend skeleton with Bootstrap 5 (layout, navbar, routing)
- [x] Define and create all `/config` JSON file structures with example templates
- [ ] Set up CI/CD pipeline (automated tests, linting, Docker build, deployment to staging)
- [x] Set up structured logging framework

**Deliverable:** Running skeleton application with database connectivity, login page (UI only), and CI/CD pipeline.

---

## M2 – Authentication & User Management (Weeks 4–7)

**Goal:** Full AD authentication, daily sync job, user profile database table, language switching.

- [x] Implement LDAP/LDAPS connection and credential validation on login
- [x] Implement daily scheduled AD sync job (group membership, name, email import)
- [x] Create `user_profiles` table and profile management UI (user self-service + admin edit)
- [x] Implement JWT session token issuance and validation (HttpOnly cookie)
- [x] Role assignment from AD group configuration
- [x] Admin UI: user list, profile editing, role override, manual deactivation
- [x] Implement language selection (English / German) with i18n resource files
- [x] Language preference stored in user profile; applied globally to UI and emails
- [x] Implement default local accounts (`admin` / `user`) with bcrypt password storage
- [x] Mandatory password change prompt on first login for default accounts
- [x] Warning banner in admin backend if default passwords are still active
- [x] Emergency admin account (local DB) as AD fallback

**Deliverable:** Complete authentication flow via AD, daily sync, user profiles in DB, and language switching.

---

## M3 – Core Booking & Room Management (Weeks 8–12)

**Goal:** Full booking functionality for meeting rooms and halls, public room view.

- [x] Admin UI: room and hall management (CRUD, capacity, type, catering options, seating layouts)
- [x] Admin UI: company management (CRUD, default company)
- [x] Admin UI: seating layout management (CRUD, image upload)
- [x] Booking form with all required fields (date, time, attendees, company, cost centre, attendee emails)
- [x] Real-time availability check and conflict detection (< 500 ms)
- [x] Room selection with filtering (type, capacity, catering options)
- [x] Calendar views: week view, room overview (all rooms side by side – public view)
- [x] Booking edit form
- [x] Booking move via edit form (drag & drop deferred to M4 UI polish)
- [x] Booking copy (pre-fill all fields, new date/time/room)
- [x] Booking cancellation with status flag (`CANCELLED`)
- [x] Catering selection per booking
- [x] Seating layout selection for halls
- [x] Public Room View: unauthenticated page, all rooms side by side for today
- [x] Public Room View: auto-refresh every 60 seconds
- [x] Public Room View: no PII displayed, current-time indicator line
- [x] Responsive layout validation (desktop ≥1280px, tablet 768–1279px)

**Deliverable:** Fully functional booking system (no email/Exchange yet) and live public room view.

---

## M4 – Recurring Appointments, Email & iCal (Weeks 13–17)

**Goal:** Recurring series logic, email notifications, iCal generation.

- [x] Implement recurring series: daily (every N days), weekly (selected days, every N weeks), monthly (same day or weekday)
- [x] Series end by date or occurrence count
- [x] Conflict checking across all occurrences before saving series
- [x] Edit single occurrence within a series (detaches from series)
- [x] Delete single occurrence within a series
- [x] Edit entire series / from this occurrence onward (confirmation prompt via edit-scope selector)
- [x] Delete entire series / from this occurrence onward (confirmation prompt in cancel modal)
- [x] SMTP integration and email send service (Nodemailer)
- [x] iCal generation (RFC 5545) – `METHOD:REQUEST` for new/updated bookings
- [x] iCal generation (RFC 5545) – `METHOD:CANCEL` for cancelled bookings
- [x] Email templates in English and German (inline HTML, language-aware)
- [x] Email language matches booking creator's language preference
- [x] SMTP configuration in admin backend (`/admin/settings`, AES-256 password storage)
- [x] Email log in admin backend (recipient, status, timestamp – existing logs page)
- [ ] Integration testing with Outlook, Thunderbird, and Apple Calendar (manual QA)

**Deliverable:** Complete notification system with iCal invitations in both languages.

---

## M5 – Exchange Synchronisation & Reporting (Weeks 18–21)

**Goal:** Optional Exchange integration, full reporting module, and admin dashboard.

- [ ] Exchange EWS integration (create, update, cancel calendar items in resource mailboxes)
- [ ] Microsoft Graph API integration (primary alternative to EWS)
- [ ] Room-to-resource-mailbox mapping configuration in admin UI
- [ ] Exchange sync log in admin backend (per-booking status, error messages, retry history)
- [ ] Retry mechanism for failed Exchange sync operations
- [ ] Report: bookings per cost centre (month, year, custom range)
- [ ] Report: bookings per room (month, year, custom range)
- [ ] Report: catering quantities (beverages, pastries, bread rolls) by room / cost centre
- [ ] Report: room utilisation rate by room
- [ ] Report: bookings per company
- [ ] Report: cancelled bookings by room / cost centre
- [ ] PDF report export (server-side generation with charts and formatted tables)
- [ ] CSV raw data export
- [ ] Admin dashboard: today's room utilisation
- [ ] Admin dashboard: most booked rooms (current month)
- [ ] Admin dashboard: top cost centres by booking count
- [ ] Admin dashboard: catering summary for current month
- [ ] Admin dashboard: Exchange sync status indicator

**Deliverable:** Exchange synchronisation (optional) and complete reporting & dashboard module.

---

## M6 – Testing, Hardening & Go-Live (Weeks 22–24)

**Goal:** Production readiness, security audit, user acceptance, and go-live.

- [ ] End-to-end testing of all user stories (Employee, Admin, Public Viewer roles)
- [ ] Performance and load testing (100 concurrent users, large booking datasets)
- [ ] Security audit: OWASP Top 10 review
- [ ] Penetration testing
- [ ] Dependency vulnerability scan
- [ ] Fix all critical and high-severity bugs
- [ ] Accessibility review (WCAG 2.1 AA, keyboard navigation, screen reader basics)
- [ ] Write employee user documentation
- [ ] Write admin user documentation
- [ ] Administrator training session
- [ ] Production deployment with monitoring and alerting
- [ ] Hypercare phase: 2 weeks active support post go-live

**Deliverable:** Production-ready application, documentation, completed go-live, hypercare support.

---

## Tech Stack Decisions

| Layer | Technology |
|---|---|
| Backend | Node.js (Express) |
| Frontend | SSR with Bootstrap 5 |
| Database | PostgreSQL 15+ with Prisma ORM |
| Authentication | LDAP/LDAPS + JWT (HttpOnly cookie) |
| Email | Nodemailer + iCal generation |
| Exchange | EWS / Microsoft Graph API (optional) |
| PDF Generation | Puppeteer |
| Config Encryption | AES-256 |
| Deployment | Docker / Docker Compose |
| Reverse Proxy | Nginx |
| Logging | Winston (structured JSON) |
| CI/CD | GitHub Actions |

---

## Database Tables

| Table | Description |
|---|---|
| `users` | AD-imported users (username, name, email, active) |
| `user_profiles` | Company, cost centre, language preference |
| `roles` | Role definitions |
| `user_roles` | User ↔ role assignments |
| `rooms` | Room/hall definitions |
| `room_catering_options` | Catering options per room |
| `seating_layouts` | Seating layout definitions |
| `room_seating_layouts` | Hall ↔ seating layout |
| `companies` | Company master list |
| `bookings` | All bookings |
| `booking_catering` | Catering selections per booking |
| `booking_attendees` | Attendee emails per booking |
| `recurring_series` | Recurrence definitions |
| `audit_log` | Immutable booking operation log |
| `exchange_sync_log` | Exchange sync results |
| `email_log` | Email send history |
| `ad_sync_log` | AD sync history |

---

## Configuration Files

| File | Purpose |
|---|---|
| `app.config.json` | App name, base URL, port, default language, session timeout, archive retention |
| `database.config.json` | DB connection settings |
| `ad.config.json` | LDAP settings, group-to-role mapping, sync schedule |
| `smtp.config.json` | SMTP settings |
| `exchange.config.json` | Exchange/Graph integration settings |
| `roles.config.json` | Role definitions |
| `i18n.config.json` | i18n settings and resource paths |
