# 🎉 Eventra

> **Discover events. Book tickets. Arrive with confidence.**

Eventra is a modern event management platform that enables attendees to discover events, reserve free tickets or purchase paid tickets, receive secure QR-code tickets, and enjoy seamless event check-in. Organizers can create and manage events, monitor ticket sales, receive payouts, and promote their events, while administrators oversee platform operations and event approvals.

> 🚧 **Status:** Under Active Development

This repository contains the Eventra codebase, which is currently under active development. The backend foundation has been established and is being expanded iteratively, while the frontend application will be integrated as development progresses.

---

# 📚 About This Project

Eventra is being developed as part of the **Tech Studio Academy Full Stack Web Development Internship**.

The project simulates the development of a real-world software product by applying modern software engineering practices—from product requirements and system design to backend development, frontend integration, deployment, and collaborative development using Git and GitHub.

The objective is to build a scalable, secure, and user-friendly event management platform while demonstrating best practices in software engineering.

---

# 🚀 Project Information

| Property | Value |
|----------|-------|
| **Project Name** | Eventra |
| **Status** | 🚧 In Development |
| **Project Type** | Full Stack Web Application |
| **Industry** | Event Management |
| **Backend** | Node.js, Express.js, TypeScript |
| **Frontend** | React + TypeScript *(Coming Soon)* |
| **Database** | MongoDB |
| **Deployment** | Vercel |

---

# ✨ Vision

Eventra aims to simplify event discovery, ticketing, and event management through a secure, scalable, and intuitive platform.

The platform is designed to serve three primary user groups:

- **Attendees** – Discover events, reserve free tickets, purchase paid tickets, and manage digital tickets.
- **Organizers** – Create and manage events, monitor ticket sales, validate attendees, and receive payouts.
- **Administrators** – Oversee platform operations, approve organizers and events, manage users, and monitor platform performance.

---

# 🛠 Tech Stack

## Backend

- Node.js
- Express.js
- TypeScript
- MongoDB (Mongoose)
- Redis
- Nodemailer
- Express Rate Limiter
- Cron Jobs
- Vercel

## Frontend *(Coming Soon)*

- React
- TypeScript
- Tailwind CSS
- React Router
- Axios

---

# 📁 Project Structure

```text
eventra/
│
├── server/
│   ├── api/
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── email/
│   │   ├── jobs/
│   │   ├── lib/
│   │   ├── middlewares/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── services/
│   │   └── index.ts
│   │
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.json
│   ├── vercel.json
│   └── .gitignore
│
├── README.md
└── .gitignore
```

---

# 🏗 Current Development Progress

The project is currently in its foundation phase.

The following backend infrastructure has been implemented to establish a scalable architecture for future development.

## Infrastructure

- Express.js server setup
- TypeScript configuration
- MongoDB database connection
- Environment configuration
- Structured logging
- Session configuration

## Middleware

- Global error handling
- Rate limiting
- Cache middleware

## Email Infrastructure

- Email controller
- Email service
- Email templates
- Email queue
- Email cron processing
- Email sending utility

## Utilities

- Response handler
- Try/Catch wrapper
- Cache utilities

## Deployment

- Vercel configuration
- Environment variable support

> **Note:** The backend is still under active development. Core business functionality such as authentication, event management, ticketing, payments, user management, and QR-code workflows will be implemented in subsequent development phases.

---

# 🚧 Planned MVP Features

## 👤 Attendee

- User registration & authentication
- Browse and search events
- Event filtering
- RSVP for free events
- Purchase paid tickets
- QR-code ticket generation
- Saved events
- Profile management
- Order history

---

## 🏢 Organizer Dashboard

- Organizer registration
- Create and manage events
- Ticket management
- Sales dashboard
- Attendee management
- QR-code check-in
- Offline check-in
- Event promotion
- Payout management

---

## 🛡 Administrator Dashboard

- Organizer approval
- Event approval
- User management
- Event category management
- Refund processing
- Promotion approval
- Platform analytics

---

## 💳 Payments

- Paystack integration
- Platform commission
- Organizer payouts
- Payment verification

---

## 🎫 Ticketing

- QR code generation
- Ticket validation
- One-time QR check-in
- Offline ticket scanning

---

# ⚙️ Getting Started

## Clone the repository

```bash
git clone https://github.com/bukolaolafenwa/eventra.git
```

## Navigate to the backend

```bash
cd eventra/server
```

## Install dependencies

```bash
npm install
```

## Configure Environment Variables

Create a `.env` file inside the `server` directory.

```env
PORT=
MONGO_URI=
JWT_SECRET=
REDIS_URL=
CRON_SECRET=
EMAIL_HOST=
EMAIL_PORT=
EMAIL_USER=
EMAIL_PASSWORD=
```

Update the variables with your own development credentials.

## Start the development server

```bash
npm run dev
```

The backend will be available at:

```text
http://localhost:4000
```

---

# 🔄 Development Workflow

This project follows a collaborative Git workflow.

Create a feature branch:

```bash
git checkout -b feature/your-feature
```

Commit your changes:

```bash
git add .
git commit -m "Implement your feature"
```

Push your branch:

```bash
git push origin feature/your-feature
```

Open a Pull Request for review before merging into `main`.

---

# 📌 Development Roadmap

## Backend

- ✅ Backend project setup
- ✅ Project architecture
- ✅ Database configuration
- ✅ Middleware foundation
- ✅ Email infrastructure
- ⏳ Authentication & Authorization
- ⏳ User Management
- ⏳ Event Management APIs
- ⏳ Ticket Management
- ⏳ QR Code Generation
- ⏳ Payment Integration
- ⏳ Organizer APIs
- ⏳ Administrator APIs

## Frontend

- ⏳ Frontend project setup
- ⏳ Landing page
- ⏳ Authentication pages
- ⏳ Event discovery
- ⏳ Organizer dashboard
- ⏳ Administrator dashboard

## Deployment

- ⏳ Production deployment
- ⏳ CI/CD pipeline

---

# 🤝 Contributing

Contributions are welcome.

1. Fork the repository.
2. Create a feature branch.

```bash
git checkout -b feature/your-feature
```

3. Commit your changes.

```bash
git commit -m "Implement your feature"
```

4. Push your branch.

```bash
git push origin feature/your-feature
```

5. Open a Pull Request.

---

# 📄 License

This project is currently under active development.

A license will be added in a future release.

---

# 👨‍💻 Author

**Bukola Olafenwa**

Full Stack Web Developer

GitHub: https://github.com/bukolaolafenwa

---

> Developed as part of the **Tech Studio Academy Full Stack Web Development Internship**.