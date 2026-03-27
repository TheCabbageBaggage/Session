# Requirements Document – Session Room Booking System

**Project:** Session  
**Version:** 2.1  
**Date:** March 27, 2026  
**Status:** Draft  
**Created by:** Senior Development Team

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Target Groups & Roles](#2-target-groups--roles)
3. [Functional Requirements](#3-functional-requirements)
   - 3.1 Authentication & User Management
   - 3.2 Room & Hall Booking
   - 3.3 Booking Options & Additional Services
   - 3.4 Recurring Appointments & Booking Management
   - 3.5 Email Notifications & iCal
   - 3.6 Microsoft Exchange Synchronisation
   - 3.7 Public Room View
   - 3.8 Administrator Backend
   - 3.9 Reporting & Export
4. [Non-Functional Requirements](#4-non-functional-requirements)
5. [System Architecture](#5-system-architecture)
   - 5.1 Database
   - 5.2 Configuration
   - 5.3 Infrastructure & Tech Stack
   - 5.4 Frontend Framework
6. [Interfaces](#6-interfaces)
7. [Security & Data Protection](#7-security--data-protection)
8. [Milestone Plan](#8-milestone-plan)
9. [Risks & Dependencies](#9-risks--dependencies)
10. [Glossary](#10-glossary)

---

## 1. Project Overview

### 1.1 Purpose

**Session** is a web-based application for managing and booking meeting rooms and conference halls within an organisation. The system enables employees to reserve rooms with all relevant parameters (date, time, attendee count, catering, seating layout, etc.), manage existing bookings, and receive automated notifications. It integrates with Active Directory for authentication, maintains user-specific data in a local database table, and optionally synchronises with Microsoft Exchange.

### 1.2 Project Goals

- Centralised, intuitive booking management for meeting rooms and halls
- AD-based authentication with user profile data maintained in the application database
- Seamless optional integration with Microsoft Exchange
- A publicly accessible room calendar view showing today's bookings for all rooms
- Transparent reporting for administrators by cost centre, room, and time period
- High usability with minimal manual effort for end users
- Fully responsive web interface based on Bootstrap

### 1.3 Out of Scope

The following items are explicitly excluded from this project:

- Native mobile app (responsive web only)
- Room management for external sites without network connectivity
- Video conferencing integration (planned for future phases)
- Payment processing or invoice generation
- Real-time push notifications (WebSocket / SSE) in phase 1

---

## 2. Target Groups & Roles

| Role | Description |
|---|---|
| **Employee (Booker)** | Regular authenticated user who can create, edit, and cancel their own room bookings. Authenticated via AD group membership. |
| **Administrator** | Full access to all bookings, room management, user profiles, company definitions, seating layouts, reports, and system configuration. |
| **Public Viewer** | Unauthenticated access to the read-only public room overview screen showing today's bookings across all rooms. No login required. |

---

## 3. Functional Requirements

### 3.1 Authentication & User Management

#### 3.1.1 Active Directory Authentication

- Users are authenticated exclusively via Active Directory (LDAP / LDAPS).
- Only members of one or more configured AD groups are granted access to the application.
- The AD group-to-role mapping is defined in the application configuration file (`ad.config.json`).
- AD group membership is synchronised **once per day** via a scheduled background job (configurable start time, e.g. 02:00).
- The daily sync updates group memberships and adds/deactivates users accordingly. No real-time group queries are made during login.
- On login, the system verifies the user's credentials against AD (LDAP bind). If the bind succeeds and the user exists in the local user table, access is granted.
- A local emergency administrator account (stored in the database) is available as a fallback if AD is unreachable.

#### 3.1.2 User Profile Data – Database Table

- User profile data (company and cost centre) is **not** read from AD attributes. It is maintained in a dedicated **user profile table** in the application database.
- The following data is stored per user in the database:

| Field | Source | Editable by User | Editable by Admin |
|---|---|---|---|
| Username (sAMAccountName) | AD (sync) | No | No |
| First Name | AD (sync) | No | Yes |
| Last Name | AD (sync) | No | Yes |
| Email Address | AD (sync) | No | Yes |
| Company | DB user profile table | Pre-filled by admin / self | Yes |
| Cost Centre | DB user profile table | Pre-filled by admin / self | Yes |
| Role | Configuration / Admin | No | Yes |
| Active | AD sync / Admin | No | Yes |

- When creating a booking, the user's company and cost centre are pre-filled from the database user profile table.
- The user may override these values for a specific booking. Overrides are saved with the booking only and do not modify the user profile.
- Administrators can edit any user's profile data (company, cost centre, role) in the admin backend.
- Users can update their own company and cost centre via a profile settings page.

#### 3.1.3 Role Management

- Two roles are supported: **Employee** and **Administrator**.
- Role assignment is configured by mapping AD groups to roles in `ad.config.json`.
- Administrators can manually override a user's role in the admin backend regardless of AD group membership.

#### 3.1.4 Language Setting

- The application supports two interface languages: **English** and **German**.
- The default language is configurable in `app.config.json`.
- Each user can select their preferred language in their profile settings. The preference is stored in the user profile table.
- All UI labels, notifications, and system messages are fully translated in both languages.
- Email notifications are sent in the language of the booking creator.

#### 3.1.5 Initial Default Accounts

Upon first installation, the system automatically creates two built-in local accounts in the database. These accounts are independent of Active Directory and are intended solely for initial setup and emergency access.

| Account | Username | Default Password | Role |
|---|---|---|---|
| Default Administrator | `admin` | `admin` | Administrator |
| Default User | `user` | `user` | Employee |

**Important notices regarding default accounts:**

- Both accounts are created during the database initialisation migration and are active immediately on first launch.
- The admin backend displays a **prominent warning banner** if either default account still has its factory password, prompting the administrator to change it.
- Passwords for local accounts are stored as **bcrypt hashes** (minimum cost factor 12) in the database. Plaintext passwords are never persisted.
- Default account passwords **must be changed** before the system is used in a production environment. This is enforced by displaying a mandatory password change prompt on first login for both accounts.
- Local accounts are not subject to AD authentication. They use the application's own username/password login form.
- The `admin` account cannot be deleted or deactivated via the UI to prevent accidental lockout. Its role cannot be demoted below Administrator.
- The `user` account can be deactivated or deleted by an administrator once real users have been imported from AD.
- Both accounts are clearly marked as "Local Account" in the user management section of the admin backend.

---

### 3.2 Room & Hall Booking

#### 3.2.1 Booking Form – Required Fields

Every booking requires the following information:

| Field | Type | Notes |
|---|---|---|
| Date | Date | Single date or recurring series definition |
| Start Time | Time (HH:MM) | Must be before end time |
| End Time | Time (HH:MM) | Must be after start time |
| Number of Attendees | Integer | Must be ≤ room capacity |
| Company | Dropdown / Free text | Pre-filled from user profile; overridable per booking |
| Cost Centre | Dropdown / Free text | Pre-filled from user profile; overridable per booking |
| Attendee Email Addresses | List of emails | Multiple entries; used for iCal invitations |

#### 3.2.2 Room Selection

- All rooms and halls available for the selected date and time range are displayed.
- Rooms already booked during the requested time slot are shown as unavailable (greyed out or hidden, configurable).
- Filtering options: room type (meeting room / hall), minimum capacity, available catering options.
- Calendar views available: **day view**, **week view**, **room overview** (all rooms side by side for a selected day).

#### 3.2.3 Room Types

Two room types are supported:

| Type | Specifics |
|---|---|
| **Meeting Room** | Standard booking without seating layout selection |
| **Hall** | Includes an additional required seating layout selection (defined by admin) |

#### 3.2.4 Seating Layout Options (Halls Only)

- The administrator defines available seating layout options (e.g. Theatre, Parliamentary, U-Shape, Banquet, Classroom).
- Each option may optionally include a description and an image/diagram.
- When booking a hall, the user must select one seating layout from the list.
- Seating layout options are managed in the admin backend and stored in the database.

---

### 3.3 Booking Options & Additional Services

Optional catering services can be added to any booking (meeting room or hall):

| Service | Input Type | Notes |
|---|---|---|
| **Non-alcoholic beverages** | Yes/No or quantity | Availability configurable per room by admin |
| **Pastries** | Yes/No or quantity | Availability configurable per room by admin |
| **Bread rolls / sandwiches** | Yes/No or quantity | Availability configurable per room by admin |

- Which catering options are available for each room is configured by the administrator in the room settings.
- Catering selections are stored with the booking and included in reporting.

---

### 3.4 Recurring Appointments & Booking Management

#### 3.4.1 Recurring Bookings

- Bookings can be created as a recurring series.
- Supported recurrence patterns:
  - **Daily** – every N days
  - **Weekly** – on selected days of the week, every N weeks
  - **Monthly** – on the same calendar day or the same weekday of the month
- A series must have either an end date or a maximum occurrence count.
- The system checks availability for all occurrences before saving the series. Conflicts are reported to the user before confirmation.
- After creation, individual occurrences within a series can be edited or deleted independently.
- The entire series can be edited or deleted at once, with a confirmation prompt.

#### 3.4.2 Moving Bookings

- Bookings can be moved to a different room or time slot via:
  - Drag & Drop in the calendar view
  - An edit form with room and time selection
- The system validates availability of the target room for the new time slot before confirming the move.
- After a successful move, a change notification email with an updated iCal attachment is sent to all attendees.

#### 3.4.3 Copying Bookings

- Any booking can be copied.
- All fields except date and time are pre-filled in the new booking form.
- The user selects the new date, time, and room.
- Copying creates a new independent booking (not linked to the original).

#### 3.4.4 Cancellation

- Bookings can be cancelled by the booking creator or an administrator.
- Upon cancellation, a cancellation email with an iCal attachment (`METHOD:CANCEL`) is sent to all attendees.
- Cancelled bookings are retained in the database with a `CANCELLED` status for reporting purposes.

---

### 3.5 Email Notifications & iCal

#### 3.5.1 Notification Triggers

| Event | Notification |
|---|---|
| New booking created | Invitation email with iCal attachment (`METHOD:REQUEST`) |
| Booking changed (room, time, details) | Update email with iCal attachment (`METHOD:REQUEST`) |
| Booking cancelled | Cancellation email with iCal attachment (`METHOD:CANCEL`) |

#### 3.5.2 Email Content

- Subject line: Room name, date, and time range
- Body: Full booking details (room, time, attendee count, seating layout if applicable, catering selections)
- iCal file as attachment (RFC 5545 compliant)
- From address configurable via `smtp.config.json`
- Email language matches the booking creator's language preference

#### 3.5.3 iCal Specification

| Field | Value |
|---|---|
| Standard | RFC 5545 (iCalendar) |
| `UID` | Unique booking ID (stable across updates) |
| `METHOD` | `REQUEST` (new / updated) or `CANCEL` |
| `ORGANIZER` | Booking creator's email address |
| `ATTENDEE` | All entered attendee email addresses |
| `LOCATION` | Room name |
| `DESCRIPTION` | Booking details including catering and seating layout |
| `DTSTART` / `DTEND` | Booking start and end time (local timezone, with TZID) |

---

### 3.6 Microsoft Exchange Synchronisation

- Exchange synchronisation is **optional** and can be enabled or disabled in `exchange.config.json`.
- When enabled, all booking operations are mirrored to Exchange resource mailboxes.
- Configurable parameters:

| Parameter | Description |
|---|---|
| Enabled | Boolean flag to activate/deactivate the sync |
| EWS Endpoint / MS Graph URL | Exchange server URL |
| Service Account | Credentials for the Exchange service account |
| Sync Mode | `EWS` (Exchange Web Services) or `MSGraph` (Microsoft Graph API) |
| Resource Mailbox per Room | Mapping of room ID to Exchange resource mailbox address |
| Retry Attempts | Number of retry attempts on sync failure |

- Sync operations:
  - **New booking** → create calendar item in the room's resource mailbox
  - **Updated booking** → update the existing calendar item
  - **Cancelled booking** → delete / cancel the calendar item
- All sync operations are logged. Errors are visible in the admin backend under "Exchange Sync Log".
- If Exchange sync fails, the booking is still saved locally. The sync error is flagged for manual review.

---

### 3.7 Public Room View

- A publicly accessible, **read-only** web page displays all room bookings for **today** without requiring any login.
- The URL is fixed and accessible from within the organisation's network (configurable: internal only or publicly reachable).
- Layout: All rooms are shown **side by side** as vertical timeline columns, similar to a day planner.
- Each column represents one room or hall and shows its bookings as time blocks.
- Booking blocks display: room name, booking title or purpose (if provided), time range, number of attendees.
- Sensitive details (attendee email addresses, cost centre, company) are **not** shown in the public view.
- The view auto-refreshes at a configurable interval (default: every 60 seconds) without manual page reload.
- The current time is indicated by a horizontal line across all columns.
- The public view is responsive and suitable for display on wall-mounted screens or info panels (kiosk mode).
- Design uses Bootstrap and matches the main application's visual style.

---

### 3.8 Administrator Backend

#### 3.8.1 Room Management

Create, edit, and delete rooms and halls. Configurable attributes per room:

| Attribute | Type | Notes |
|---|---|---|
| Name | Text | Displayed in booking UI and public view |
| Description | Text | Optional |
| Location / Floor | Text | Building, floor, wing |
| Capacity | Integer | Maximum number of attendees |
| Room Type | Enum | Meeting Room or Hall |
| Available Catering | Multi-select | Non-alcoholic beverages, pastries, bread rolls |
| Seating Layouts | Multi-select | Applicable to halls only |
| Image / Floor Plan | File upload | Optional; shown in booking form |
| Exchange Resource Mailbox | Email | Optional; used if Exchange sync is enabled |
| Active | Boolean | Inactive rooms are hidden from the booking UI |

#### 3.8.2 Company Management

- Create, edit, and delete company entries.
- Companies appear as a dropdown selection in the booking form.
- A company can be marked as default.

#### 3.8.3 Seating Layout Management

- Create, edit, and delete seating layout options.
- Each option has a name, optional description, and optional image.
- Layouts are assigned to halls in the room management section.

#### 3.8.4 User Management

- Overview of all users imported from AD.
- Administrators can:
  - View user profiles (name, email, company, cost centre, role, last login)
  - Edit company, cost centre, and role for any user
  - Deactivate users manually (independent of AD sync)
- Display of last AD sync timestamp and next scheduled sync.

#### 3.8.5 Booking Overview

- Full calendar view of all bookings (day, week, month).
- Filterable by room, cost centre, company, and date range.
- Administrators can directly edit, move, or cancel any booking.

#### 3.8.6 System Configuration

- Administrators can view and edit configuration files via a structured form UI (no raw JSON editing required).
- Changes to configuration trigger a validation check before saving.
- Sensitive fields (passwords, credentials) are stored encrypted and displayed masked.
- Configuration sections: General Settings, Database, Active Directory, SMTP, Exchange, Roles & Groups.

#### 3.8.7 Logs & Monitoring

- **AD Sync Log**: Timestamp, number of users added/updated/deactivated, errors.
- **Exchange Sync Log**: Per-booking sync status, error messages, retry history.
- **Email Log**: Sent emails, recipient, status (success / failure).
- **Audit Log**: All booking actions (create, update, delete, cancel) with user and timestamp.
- Logs are filterable and downloadable as CSV.

---

### 3.9 Reporting & Export

#### 3.9.1 Available Reports

| Report | Grouping | Time Period |
|---|---|---|
| Bookings per cost centre | Cost Centre | Month, year, custom range |
| Bookings per room | Room | Month, year, custom range |
| Catering quantities (beverages, pastries, bread rolls) | Room / Cost Centre | Month, year, custom range |
| Room utilisation rate | Room | Month, year, custom range |
| Bookings per company | Company | Month, year, custom range |
| Cancelled bookings | Room / Cost Centre | Month, year, custom range |

#### 3.9.2 Export Formats

- **CSV**: Raw data export for further processing in Excel or BI tools.
- **PDF**: Formatted report with tables, totals, and summary charts. Generated server-side.

#### 3.9.3 Admin Dashboard

The admin dashboard displays key metrics on the landing page:

- Today's room utilisation (number of active bookings / total available slots)
- Most booked rooms (current month)
- Top cost centres by booking count
- Catering summary for the current month (quantities per service type)
- Exchange sync status indicator (last successful sync, error count)

---

## 4. Non-Functional Requirements

### 4.1 Performance

- Booking calendar and room overview must load within 2 seconds on a local network.
- The system must support at least 100 concurrent users without performance degradation.
- Booking conflict detection must respond in real time (< 500 ms API response).
- The public room view must load within 3 seconds including all booking data for the current day.

### 4.2 Availability

- Target uptime: 99.5% during business hours (Mon–Fri, 06:00–22:00).
- Planned maintenance windows should be scheduled outside core hours.
- AD sync failures must not prevent authenticated users from logging in (last-known group membership is cached in the DB).

### 4.3 Scalability

- Support for up to 500 rooms/halls.
- Support for up to 5,000 users.
- Bookings older than 2 years are archived (configurable retention period).

### 4.4 Usability

- A booking must be completable in a maximum of 5 steps from any starting point.
- Clear, user-friendly validation messages for missing fields and time conflicts.
- The public room view must be legible on a 40"–55" wall-mounted display at typical viewing distance.

### 4.5 Responsive Design

- The application must be fully responsive and functional on:
  - Desktop (≥ 1280px)
  - Tablet (768px – 1279px)
  - The public room view is additionally optimised for landscape display screens
- Bootstrap 5 is the mandatory UI framework for all frontend components.
- No custom CSS framework or CSS-in-JS solution should replace Bootstrap's grid and component system.

### 4.6 Internationalisation

- All user-facing text is externalised into language resource files (e.g. JSON or YAML).
- Supported languages at launch: **English** (default), **German**.
- Dates, times, and number formats are localised according to the user's language setting.
- Additional languages can be added by providing a new resource file without code changes.

### 4.7 Maintainability

- Modular backend architecture (separation of concerns: routing, business logic, data access).
- Full REST API documentation generated via OpenAPI / Swagger.
- Automated unit and integration tests with a minimum code coverage of 80%.
- All critical operations are logged with user identity and timestamp.
- Database schema changes are managed via versioned migration scripts.

---

## 5. System Architecture

### 5.1 Database

- **Database engine:** Relational SQL database — recommended: **PostgreSQL** (primary) or **Microsoft SQL Server**.
- All application data is stored in a single database with clearly separated schemas/table groups.

**Core tables:**

| Table | Description |
|---|---|
| `users` | Users imported from AD (username, name, email, active flag) |
| `user_profiles` | Company, cost centre, language preference per user |
| `roles` | Role definitions (Employee, Administrator) |
| `user_roles` | Many-to-many: user ↔ role assignments |
| `rooms` | Room and hall definitions (name, type, capacity, options) |
| `room_catering_options` | Available catering per room |
| `seating_layouts` | Seating layout definitions (name, description, image) |
| `room_seating_layouts` | Many-to-many: hall ↔ seating layout |
| `companies` | Company master list |
| `bookings` | All bookings (date, time, room, attendees, status) |
| `booking_catering` | Catering selections per booking |
| `booking_attendees` | Attendee email addresses per booking |
| `recurring_series` | Recurrence definitions linked to bookings |
| `audit_log` | Immutable log of all booking operations |
| `exchange_sync_log` | Exchange synchronisation results per booking |
| `email_log` | Email send history and status |
| `ad_sync_log` | AD synchronisation history |

**Notes:**
- All foreign keys are enforced at the database level.
- Soft deletes (status flag) are used for bookings to preserve audit history.
- Indexes are defined on frequently queried columns (date, room ID, user ID, status).
- Database credentials are stored in `database.config.json` with encrypted password field.

### 5.2 Configuration

All configuration is stored as **JSON files** in a `/config` directory at the application root:

| File | Contents |
|---|---|
| `app.config.json` | App name, base URL, port, default language, session timeout, archive retention |
| `database.config.json` | DB host, port, name, user, encrypted password, connection pool settings |
| `ad.config.json` | LDAP server URL, bind DN, encrypted bind password, base DN, AD group names, role mapping, sync schedule |
| `smtp.config.json` | SMTP host, port, TLS mode, sender address, encrypted credentials |
| `exchange.config.json` | Enabled flag, EWS/Graph endpoint, service account, encrypted password, room-to-mailbox mapping, retry settings |
| `roles.config.json` | Role definitions and AD group assignments |
| `i18n.config.json` | Default language, available languages, resource file paths |

**Rules:**
- All password/credential fields are AES-256 encrypted at rest.
- Configuration files are read at startup and cached. A restart or admin-triggered reload is required to apply changes.
- The admin backend provides a structured UI form for editing configuration — direct file editing is supported but not required.
- Configuration files must never be committed to version control with real credentials. A `.config.example.json` template is provided for each file.

### 5.3 Infrastructure & Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| **Backend** | Node.js (Express) or .NET 8 (ASP.NET Core) | RESTful API; JSON responses |
| **Frontend** | Server-side rendered (SSR) or SPA (React / Vue 3) | Must use Bootstrap 5 |
| **UI Framework** | Bootstrap 5 | Mandatory; CDN or local bundle |
| **Database** | PostgreSQL 15+ or MS SQL Server 2019+ | Managed via ORM (e.g. Prisma, EF Core, SQLAlchemy) |
| **Authentication** | LDAP / LDAPS bind + JWT session tokens | JWT stored in HttpOnly cookie |
| **AD Sync** | Scheduled background job (cron) | Runs daily at configured time |
| **Email** | SMTP with nodemailer / MailKit | iCal attachment generated server-side |
| **Exchange** | EWS or Microsoft Graph API | Optional; configurable |
| **PDF Generation** | Server-side: Puppeteer, WeasyPrint, or iText | For report export |
| **Config encryption** | AES-256 | Applied to credential fields in JSON configs |
| **Deployment** | Docker / Docker Compose | Single-host or split DB/app containers |
| **Reverse Proxy** | Nginx or IIS | TLS termination, static file serving |
| **Logging** | Structured JSON logs (e.g. Winston, Serilog) | Written to file + DB audit table |

### 5.4 Frontend Framework – Bootstrap 5

- Bootstrap 5 is used as the **sole CSS and component framework**.
- No conflicting CSS frameworks (Tailwind, Material UI, etc.) are permitted.
- Bootstrap's grid system (12-column) is used for all responsive layouts.
- Bootstrap components used: Navbar, Modal, Card, Table, Form, Alert, Badge, Offcanvas, Dropdown, Toast.
- Custom SCSS overrides are permitted for brand colours and typography only, compiled on top of Bootstrap's source.
- The public room view uses Bootstrap's grid to arrange room columns side by side with horizontal scroll on small screens.
- All interactive components (modals for booking forms, toasts for confirmations) use Bootstrap's JavaScript plugin.

---

## 6. Interfaces

| Interface | Protocol | Direction | Description |
|---|---|---|---|
| Active Directory | LDAP / LDAPS (TCP 389 / 636) | App → AD | Daily user sync (group membership, name, email) and login credential validation |
| SMTP Server | SMTP / SMTPS (TCP 25 / 465 / 587) | App → Mail Server | Send booking notifications and iCal invitations |
| Microsoft Exchange | EWS (HTTPS) or MS Graph (HTTPS) | App → Exchange | Optional: create/update/cancel calendar items in resource mailboxes |
| Internal REST API | HTTPS / JSON | Frontend ↔ Backend | All booking, room, user, and reporting operations |
| Database | SQL over TCP | Backend → DB | All persistent data read/write operations |
| Public Room View | HTTPS | Browser → App | Unauthenticated read-only access to today's booking overview |
| Admin Config UI | HTTPS | Admin Browser → App | Manage configuration files via structured form |

---

## 7. Security & Data Protection

- Authentication exclusively via Active Directory. No locally stored user passwords (except one encrypted emergency admin account).
- HTTPS is mandatory for all connections. HTTP requests are redirected to HTTPS.
- JWT session tokens stored in **HttpOnly, Secure, SameSite=Strict** cookies. Token expiry configurable (default: 8 hours).
- Role-based access control (RBAC): employees can only view and manage their own bookings; all-room visibility is admin-only.
- The public room view exposes no personally identifiable information (no names, emails, cost centres).
- All credential fields in config files are AES-256 encrypted. Keys are managed via environment variables, not stored in config files.
- SQL injection prevention via parameterised queries / ORM prepared statements.
- Input validation and sanitisation on all API endpoints (server-side).
- CSRF protection on all state-changing API endpoints.
- Audit log is append-only; no entries may be deleted or modified.
- GDPR compliance: personal data (names, email addresses) is used solely for booking and notification purposes. Data retention policy is configurable.
- All external connections (LDAP, SMTP, Exchange) use TLS.

---

## 8. Milestone Plan

### Overview

```
M1        M2           M3              M4             M5          M6
|---------|------------|----------------|--------------|-----------|--------|
Wk 1-3    Wk 4-7       Wk 8-12          Wk 13-17       Wk 18-21    Wk 22-24
```

---

### Milestone 1 – Project Setup & Architecture (Weeks 1–3)

**Goal:** Development environment, database schema, project skeleton for backend and frontend.

**Tasks:**
- Define and document tech stack, project structure, and coding standards
- Set up development, staging, and production environments (Docker Compose)
- Design and implement the full database schema (ERD) with migration scripts
- Bootstrap REST API skeleton (health endpoint, base routing, error handling middleware)
- Bootstrap frontend skeleton with Bootstrap 5 (layout, navbar, routing)
- Define and create all `/config` JSON file structures with example templates
- Set up CI/CD pipeline (automated tests, linting, Docker build, deployment to staging)
- Set up structured logging framework

**Deliverable:** Running skeleton application with database connectivity, login page (UI only), and CI/CD pipeline.

---

### Milestone 2 – Authentication & User Management (Weeks 4–7)

**Goal:** Full AD authentication, daily sync job, user profile database table, language switching.

**Tasks:**
- Implement LDAP/LDAPS connection and credential validation on login
- Implement daily scheduled AD sync job (group membership, name, email import)
- Create `user_profiles` table and profile management UI (user self-service + admin edit)
- Implement JWT session token issuance and validation (HttpOnly cookie)
- Role assignment from AD group configuration
- Admin UI: user list, profile editing, role override, manual deactivation
- Implement language selection (English / German) with i18n resource files
- Language preference stored in user profile; applied globally to UI and emails
- Implement emergency admin account (local DB) with secure password storage

**Deliverable:** Complete authentication flow via AD, daily sync, user profiles in DB, and language switching.

---

### Milestone 3 – Core Booking & Room Management (Weeks 8–12)

**Goal:** Full booking functionality for meeting rooms and halls, public room view.

**Tasks:**
- Admin UI: room and hall management (CRUD, capacity, type, catering options, seating layouts)
- Admin UI: company management and seating layout management
- Booking form with all required fields, real-time availability check, conflict detection
- Calendar views: day view, week view, room overview (all rooms side by side)
- Booking edit, move (drag & drop + form), copy, and cancellation
- Catering selection per booking
- Seating layout selection for halls
- **Public Room View**: unauthenticated page showing all rooms side by side for today; Bootstrap grid layout; auto-refresh every 60 seconds
- Responsive layout validation across desktop and tablet

**Deliverable:** Fully functional booking system (no email/Exchange yet) and live public room view.

---

### Milestone 4 – Recurring Appointments, Email & iCal (Weeks 13–17)

**Goal:** Recurring series logic, email notifications, iCal generation.

**Tasks:**
- Implement recurring series (daily, weekly, monthly) with conflict checking across all occurrences
- Edit / delete single occurrence and entire series
- SMTP integration and email send service
- iCal generation (RFC 5545) for new, updated, and cancelled bookings
- Email templates in English and German (matching user language preference)
- SMTP configuration in admin backend
- Email log in admin backend
- Integration testing with Outlook, Thunderbird, and Apple Calendar

**Deliverable:** Complete notification system with iCal invitations in both languages.

---

### Milestone 5 – Exchange Synchronisation & Reporting (Weeks 18–21)

**Goal:** Optional Exchange integration, full reporting module, and admin dashboard.

**Tasks:**
- Exchange EWS / Microsoft Graph integration (create, update, cancel calendar items)
- Room-to-resource-mailbox mapping configuration in admin UI
- Exchange sync log in admin backend with retry mechanism
- Implement all defined reports (bookings by cost centre, room, company; catering quantities; utilisation rate; cancellations)
- PDF report export (server-side generation with charts and formatted tables)
- CSV raw data export
- Admin dashboard with KPI widgets
- Configurable custom date range for all reports

**Deliverable:** Exchange synchronisation (optional) and complete reporting & dashboard module.

---

### Milestone 6 – Testing, Hardening & Go-Live (Weeks 22–24)

**Goal:** Production readiness, security audit, user acceptance, and go-live.

**Tasks:**
- End-to-end testing of all user stories across all roles (Employee, Admin, Public Viewer)
- Performance and load testing (100 concurrent users, large booking datasets)
- Security audit (OWASP Top 10, penetration test, dependency vulnerability scan)
- Fix all critical and high-severity bugs
- Accessibility review (WCAG 2.1 AA, keyboard navigation, screen reader basics)
- Write user documentation (employee guide, admin guide)
- Administrator training session
- Production deployment with monitoring and alerting
- Hypercare phase: 2 weeks of active support post go-live

**Deliverable:** Production-ready application, documentation, completed go-live, hypercare support.

---

### Milestone Summary

| # | Milestone | Period | Weeks |
|---|---|---|---|
| M1 | Project Setup & Architecture | Wk 1–3 | 3 |
| M2 | Authentication & User Management | Wk 4–7 | 4 |
| M3 | Core Booking & Room Management | Wk 8–12 | 5 |
| M4 | Recurring Appointments, Email & iCal | Wk 13–17 | 5 |
| M5 | Exchange Synchronisation & Reporting | Wk 18–21 | 4 |
| M6 | Testing, Hardening & Go-Live | Wk 22–24 | 3 |
| **Total** | | | **24 weeks (~6 months)** |

---

## 9. Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| AD access not available during development | Medium | High | Use a mock/test LDAP server (e.g. OpenLDAP in Docker) from day one |
| Exchange EWS deprecated or disabled in target environment | Medium | Medium | Implement MS Graph API as the primary alternative; EWS as fallback |
| User profile data (company, cost centre) not pre-populated in DB at launch | High | Medium | Provide bulk import tool (CSV → user_profiles); admin can edit individual profiles |
| AD group structure changes breaking role assignments | Medium | Medium | Flexible group-to-role mapping in config; admin can override roles manually |
| Performance issues with large booking volumes in calendar view | Low | High | Implement pagination, virtual scrolling, and server-side filtering; load test from M3 |
| GDPR requirements introduce additional scope | Low | Medium | Engage data protection officer during M1; document data flows early |
| Team resource constraints delay milestones | Medium | High | 2-week buffer built into schedule; scope can be reduced by deferring Exchange sync to post-launch |
| Bootstrap 5 version incompatibilities with chosen JS framework | Low | Low | Pin Bootstrap version; review component compatibility in M1 |

---

## 10. Glossary

| Term | Definition |
|---|---|
| **AD** | Active Directory – Microsoft's directory service for user and group management |
| **LDAP / LDAPS** | Lightweight Directory Access Protocol – protocol for AD communication; LDAPS is the TLS-secured variant |
| **iCal / iCalendar** | Standard format (RFC 5545) for calendar events and meeting invitations |
| **EWS** | Exchange Web Services – legacy SOAP-based API for Microsoft Exchange |
| **MS Graph** | Modern REST API for Microsoft 365 services, including Exchange Online |
| **JWT** | JSON Web Token – standard for stateless, signed session tokens |
| **SMTP** | Simple Mail Transfer Protocol – standard for sending email |
| **RBAC** | Role-Based Access Control – access control model based on user roles |
| **Cost Centre** | An internal organisational unit used for budget allocation and reporting |
| **Recurring Series** | A set of bookings following a defined repetition pattern (daily, weekly, monthly) |
| **Catering** | Optional food and beverage services associated with a booking |
| **Seating Layout** | The physical arrangement of chairs and tables in a hall (e.g. Theatre, U-Shape) |
| **Bootstrap 5** | Open-source CSS/JS framework for responsive, mobile-first web interfaces |
| **Public Room View** | An unauthenticated, read-only web page displaying all room bookings for today |
| **ERD** | Entity-Relationship Diagram – visual representation of the database schema |
| **OWASP** | Open Web Application Security Project – provider of web security standards and guidelines |
| **GDPR** | General Data Protection Regulation – EU regulation governing personal data processing |
| **ORM** | Object-Relational Mapper – software layer mapping database tables to application objects |
| **SSR** | Server-Side Rendering – HTML is generated on the server before being sent to the browser |
| **SPA** | Single Page Application – frontend rendered client-side via JavaScript |

---

*End of Document – Session Requirements v2.1*
