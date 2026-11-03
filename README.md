# MarketSphere - Multi-Vendor Marketplace Platform

MarketSphere is a production-grade, secure, multi-vendor e-commerce platform designed with the functional depth and workflow quality of major retail platforms (Amazon/Flipkart), structured as a maintainable modular monolith.

---

## 🚀 Key Highlights & Architectural Strengths

- **Secure Role-Based Access Control (RBAC):** Dedicated permissions across `CUSTOMER`, `SELLER`, and `ADMIN` with backend-enforced ownership checks. Sellers retain full customer shopping privileges.
- **Vetted Vendor Onboarding:** Customers apply with store details (`/seller/apply`) resulting in a `PENDING` status. No self-approval or unapproved product publishing is permitted.
- **Product Moderation Lifecycle:** Vendor products default to `PENDING_MODERATION` and require administrator review before appearing in the public catalog (`PUBLISHED`). Unmoderated items return 404 to public users.
- **Atomic Inventory Consistency:** Prevents overselling under high concurrency using atomic MongoDB `$inc` decrement and compensation rollback logic.
- **Real Razorpay Payment Integration:** Frontend integrates official Razorpay Checkout modal (`checkout.razorpay.com/v1/checkout.js`). Backend verifies authentic HMAC-SHA256 signatures via constant-time comparison and queries provider state.
- **Persistent Webhook Engine:** Verifies raw request byte streams with HMAC-SHA256 against `RAZORPAY_WEBHOOK_SECRET`. Webhook deduplication persisted in MongoDB via `PaymentWebhookEvent`.
- **Financial Refund Correctness:** Gateway refund API execution; failed provider refunds update status to `REFUND_FAILED` / `REFUND_PENDING` and are never falsely marked as `REFUNDED`.
- **Hardened Idempotency Engine:** Checkout and payment operations support `Idempotency-Key` with SHA-256 payload fingerprinting, in-flight lease locking, and 409 conflict detection.
- **Genuine Business Data:** Zero fabricated ratings or fake reviews. Aggregate star ratings and review counts are computed directly from verified delivered purchases.
- **Multi-Seller Order State Machine:** Centralized transition validator rejecting illegal state transitions (`PENDING_PAYMENT` -> `DELIVERED`, `CANCELLED` -> `CONFIRMED`, `REFUNDED` -> `PAID`).
- **HTTPS Transactional Email Engine:** Production OTP delivery via outbound HTTPS REST APIs (Port 443) supporting Resend and Brevo, completely immune to cloud hosting (Render Free Tier) outbound SMTP port 25/465/587 blocks.
- **Cryptographic OTP Security:** 6-digit numeric OTPs generated with Node.js `crypto`, stored exclusively as SHA-256 hashes, with 10-minute expirations, a 60-second cooldown timer on frontend and backend, and a 5-attempt brute-force lockout.
- **Containerized & CI/CD Ready:** Complete Docker multi-stage builds, `docker-compose.yml`, and GitHub Actions automated test & build workflows.

---

## 📚 Architectural & Technical Documentation

- [**`FINAL_CODE_AUDIT.md`**](file:///e:/E%20Commerce/FINAL_CODE_AUDIT.md) — Unsparing code-level audit comparing source code vs documentation claims.
- [**`FINAL_SECURITY_REPORT.md`**](file:///e:/E%20Commerce/FINAL_SECURITY_REPORT.md) — OWASP Top 10 threat model, authorization matrix, and mass assignment audit.
- [**`PAYMENT_INTEGRATION.md`**](file:///e:/E%20Commerce/PAYMENT_INTEGRATION.md) — Complete Razorpay payment architecture, signatures, webhooks, and refund flows.
- [**`TEST_REPORT.md`**](file:///e:/E%20Commerce/TEST_REPORT.md) — Full automated test suite breakdown (10 suites, 56 tests, 100% pass).
- [**`DEPLOYMENT_GUIDE.md`**](file:///e:/E%20Commerce/DEPLOYMENT_GUIDE.md) — Step-by-step production operations, Docker, Vercel, Render, and Atlas setup.
- [**`FINAL_PRODUCTION_REPORT.md`**](file:///e:/E%20Commerce/FINAL_PRODUCTION_REPORT.md) — Production readiness release gate sign-offs.
- [**`API_DOCUMENTATION.md`**](file:///e:/E%20Commerce/API_DOCUMENTATION.md) — REST API specification with all 38 endpoints and schemas.

---

## 🛠️ Technology Stack

- **Frontend:** React 18, Vite 5, Tailwind CSS 3, React Router v6, Axios, Razorpay Checkout SDK.
- **Backend:** Node.js 22, Express.js 4.19, Mongoose 8.3, JWT, bcryptjs, crypto.
- **Database:** MongoDB (Local / Atlas) with compound indexing and TTL collections.
- **Testing:** Jest with `mongodb-memory-server` for zero-side-effect automated testing.

---

## 📋 Quick Start & Verification

### 1. Backend Setup & Test Suite
```bash
cd backend
npm ci

# Run Complete Automated Test Suite (10 Suites, 56 Tests)
npm test

# Bootstrap Administrator Account (CLI Only)
npm run bootstrap:admin

# Start Development API Server (Port 5002)
npm run dev
```

### 2. Frontend Setup & Production Build
```bash
cd ../frontend
npm ci

# Production Bundle Build (Vite)
npm run build

# Start Development Server (Port 5173)
npm run dev
```

### 3. Default Administrative Credentials
- **Email:** `admin@marketsphere.com`
- **Password:** `Admin@MarketSphere2026!`
- **Access Route:** [http://localhost:5173/admin](http://localhost:5173/admin)
