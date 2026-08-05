# 🎉 Eventra



> **Discover events. Book tickets. Arrive with confidence.**



Eventra is a modern event management platform that enables attendees to discover events, reserve free tickets or purchase paid tickets, receive secure QR-code tickets, and enjoy seamless event check-in. Organizers can create and manage events, monitor ticket sales, receive payouts, and promote their events, while administrators oversee platform operations, approve organizers and events, and manage platform activities.



> 🚧 **Status:** Backend MVP Under Active Development



---



# 📚 About



Eventra is being developed as part of the **Tech Studio Academy Full Stack Web Development Internship**.



The project simulates the development of a production-ready software product by applying modern software engineering principles, including:



- Clean Architecture

- RESTful API Design

- Layered Application Architecture

- Authentication & Authorization

- Secure Session Management

- Backend Scalability

- Production Deployment

- Collaborative Git Workflow



The objective is to build a secure, scalable, and user-friendly event management platform while demonstrating industry-standard backend engineering practices.



---



# 🚀 Project Information



| Property | Value |

|----------|-------|

| **Project Name** | Eventra |

| **Status** | 🚧 Backend MVP In Progress |

| **Project Type** | Full Stack Web Application |

| **Industry** | Event Management |

| **Backend** | Node.js + Express.js + TypeScript |

| **Frontend** | React + TypeScript *(Coming Soon)* |

| **Database** | MongoDB Atlas |

| **Deployment** | Vercel |

| **Architecture** | Layered (Routes → Controllers → Services → Models) |



---



# ✨ Vision



Eventra aims to simplify event discovery, ticketing, and event management through a secure, scalable, and intuitive platform.



The platform serves three primary user groups:



### 👤 Attendees



- Discover events

- Search and filter events

- Reserve free tickets

- Purchase paid tickets

- Manage digital tickets

- View booking history



### 🏢 Organizers



- Create and manage events

- Monitor ticket sales

- Validate attendees

- Manage payouts

- Promote events



### 🛡 Administrators



- Manage users

- Approve organizers

- Approve events

- Manage categories

- Monitor platform activities



---



# 🛠 Tech Stack



## Backend



- Node.js

- Express.js

- TypeScript

- MongoDB Atlas

- Mongoose

- Express Session

- MemCachier

- Nodemailer (Brevo)

- Express Rate Limit

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

│   │   ├── types/

│   │   ├── utils/

│   │   └── index.ts

│   │

│   ├── package.json

│   ├── tsconfig.json

│   ├── vercel.json

│   └── .gitignore

│

├── README.md

└── .gitignore

```



---



# 🏗 Architecture



Eventra follows a layered architecture.



```text

Client

   │

Routes

   │

Controllers

   │

Services

   │

Models

   │

MongoDB

```



This architecture provides:



- Separation of concerns

- Maintainability

- Scalability

- Reusability

- Testability



---



# ✅ Current Backend Features



## Authentication & Authorization



- User registration

- User login

- Session authentication

- Role-Based Access Control (RBAC)

- Admin authorization



---



## Users



- User profile management

- Session verification



---



## Events



- Event CRUD APIs

- Organizer event management



---



## Categories



- Create category

- Retrieve active categories

- Retrieve category by ID

- Update category

- Soft delete categories

- Restore categories

- Retrieve all categories (Admin)

- Automatic slug generation



---



## Security



- Session middleware

- Global error handling

- Rate limiting

- Schema validation

- Secure environment configuration



---



## Infrastructure



- MongoDB connection management

- Optimized serverless connection reuse

- Health endpoint

- Structured logging

- Cache middleware

- Email queue

- Cron jobs

- Production deployment on Vercel



---



# 🌐 API Endpoints



## Public



```http

GET /health

GET /

GET /api/v1/categories

GET /api/v1/categories/:id

```



---



## Administrator



```http

POST   /api/v1/categories

PATCH  /api/v1/categories/:id

DELETE /api/v1/categories/:id

PATCH  /api/v1/categories/:id/restore

GET    /api/v1/categories/admin

```



> Authentication, User and Event APIs are also available and continue to evolve as development progresses.



---



# ⚙️ Getting Started



## Clone the repository



```bash

git clone https://github.com/bukolaolafenwa/eventra.git

```



---



## Navigate into the backend



```bash

cd eventra/server

```



---



## Install dependencies



```bash

npm install

```



---



## Configure Environment Variables



Create a `.env` file inside the `server` directory.



```env

# Server

PORT=4000

NODE_ENV=development



# Database

MONGO_URI=

DATABASE_NAME=



# Session

SESSION_SECRET=

SESSION_MAX_AGE=

CLIENT_URL=



# Email (Brevo)

BREVO_API_KEY=

EMAIL_OWNER=



# Cron

CRON_SECRET=



# Cache (MemCachier)

MEMCACHIER_SERVERS=

MEMCACHIER_USERNAME=

MEMCACHIER_PASSWORD=



# Bootstrap Admin (Optional)

ADMIN_NAME=

ADMIN_EMAIL=

ADMIN_PASSWORD=

ADMIN_PHONE=

```



> **Note**

>

> The **Bootstrap Admin** variables are optional. They are used to create an initial administrator account during application setup and are primarily intended for development or first-time deployment.



---



## Start the development server



```bash

npm run dev

```



The backend runs at:



```text

http://localhost:4000

```



Health endpoint:



```text

http://localhost:4000/health

```



---



# 🔄 Development Workflow



Create a feature branch.



```bash

git checkout -b feature/your-feature

```



Commit changes.



```bash

git add .

git commit -m "feat: implement feature"

```



Push to GitHub.



```bash

git push origin feature/your-feature

```



Open a Pull Request before merging into the protected branch.



---



# 📌 Development Roadmap



## ✅ Completed



- Backend project setup

- Layered architecture

- MongoDB integration

- Environment configuration

- Session management

- Authentication

- Authorization

- User APIs

- Event APIs

- Category management

- Soft delete & restore

- Email infrastructure

- Health endpoint

- Production deployment



---



## 🚧 In Progress



- Ticket management

- QR code generation

- Organizer dashboard

- Payment integration

- Notification system



---



## 📋 Planned



- React frontend

- Admin dashboard

- CI/CD pipeline

- Swagger / OpenAPI documentation

- Automated testing



---



# 🚀 Releases



| Version | Description |

|----------|-------------|

| **v0.1.0** | Initial Production Release |

| **v0.2.0** | Production Infrastructure & Health Endpoint Improvements |



---



# 🤝 Contributing



Contributions are welcome.



1. Fork the repository.

2. Create a feature branch.

3. Commit your changes.

4. Push your branch.

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