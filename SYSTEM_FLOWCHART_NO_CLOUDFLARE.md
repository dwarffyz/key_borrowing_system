# Key Borrowing System Flowchart (No Cloudflare)

This flow is based on the current implementation in `public/server/server.js` and frontend scripts.
All traffic is direct Browser -> Node/Express API -> MongoDB (no Cloudflare tunnel in path).

## 1. System Architecture (Direct Access)

```mermaid
flowchart LR
    T[Teacher Browser\n/index /dashboard /scan /create] -->|HTTPS or HTTP| API[Node.js + Express API\npublic/server/server.js]
    A[Admin Browser\n/index /admin] -->|HTTPS or HTTP| API

    API --> AUTH[Auth + Access Control\nJWT + reCAPTCHA + approval checks]
    API --> QR[QR Workflow\nGenerate, Regenerate, Scan]
    API --> KEY[Key and Locker Management]
    API --> OPS[Announcements, Feedback, Lost Reports, Maintenance, Activity Logs]

    AUTH --> DB[(MongoDB\nkey_borrowing_system)]
    QR --> DB
    KEY --> DB
    OPS --> DB

    DB --> C1[(Users/Admins)]
    DB --> C2[(Keys/Lockers)]
    DB --> C3[(QRCodes/Transactions)]
    DB --> C4[(Feedback/LostReports/Announcements/Maintenance/ActivityLogs)]
```

## 2. Teacher Registration and Approval Flow

```mermaid
flowchart TD
    S([Start]) --> C1[Teacher opens /create]
    C1 --> C2[Fill firstName, lastName, email, password + reCAPTCHA]
    C2 --> C3[POST /api/auth/register/request-code]

    C3 -->|Valid| C4[Server stores user as emailVerified=false, approvalStatus=pending\nand sends verification code]
    C3 -->|Invalid or cooldown| E1[Show error]

    C4 --> C5[Teacher enters code]
    C5 --> C6[POST /api/auth/register/verify-code]

    C6 -->|Code valid| C7[User emailVerified=true, approvalStatus=pending]
    C6 -->|Invalid or expired| E2[Show invalid/expired error]

    C7 --> A1[Admin opens approvals\nGET /api/admin/user-approvals]
    A1 --> A2{Approve or Reject?}
    A2 -->|Approve| A3[POST /api/admin/users/:id/approve]
    A2 -->|Reject| A4[POST /api/admin/users/:id/reject]

    A3 --> END1([Teacher can log in])
    A4 --> END2([Teacher login blocked])
```

## 3. Login Flow (Teacher/Admin)

```mermaid
flowchart TD
    L0([Login Page /]) --> L1{User type}

    L1 -->|Teacher| L2[Enter email/password + reCAPTCHA]
    L2 --> L3[POST /api/auth/login]
    L3 -->|Success| L4[Store userToken + userData\nRedirect /dashboard]
    L3 -->|Fail| LE1[Show error]

    L1 -->|Admin| L5[Enter username/password + reCAPTCHA]
    L5 --> L6[POST /api/auth/admin/login]
    L6 -->|Success| L7[Store adminToken + adminData\nRedirect /admin]
    L6 -->|Fail| LE2[Show error]
```

## 4. Borrow/Return Flow via QR Scan

```mermaid
flowchart TD
    B0([Teacher in /dashboard]) --> B1{Action}

    B1 -->|Borrow| B2[Click Borrow Key]
    B1 -->|Return| B3[Click Return Key]

    B2 --> B4[Redirect /scan]
    B3 --> B5[Redirect /scan]

    B4 --> B6[Scan QR]
    B5 --> B6

    B6 --> B7[Client checks QR JSON format]
    B7 -->|Invalid| BE1[Show error and resume scanning]
    B7 -->|Valid| B8[POST /api/qrcodes/scan\n{ qrData }]

    B8 --> B9{Server validation}
    B9 -->|Fail: auth, approval, maintenance, QR invalid, inactive, key state mismatch| BE2[Return error]
    B9 -->|Pass| B10{Auto-resolve action}

    B10 -->|Borrow| B11[Require key.status=available]
    B11 --> B12[Set key.status=borrowed\nset borrowedBy + borrowedAt]
    B12 --> B13[Create Transaction action=borrow]
    B13 --> B14[Mark QR used=true\nusedAt + usedBy]
    B14 --> B15[ActivityLog key.borrow]

    B10 -->|Return| B16[Require key.status=borrowed\nand borrowedBy=current user]
    B16 --> B17[Set key.status=available\nclear borrowedBy + borrowedAt]
    B17 --> B18[Create Transaction action=return]
    B18 --> B19[Mark QR used=true\nusedAt + usedBy]
    B19 --> B20[ActivityLog key.return]

    B15 --> B21[Success response]
    B20 --> B21
    B21 --> B22[Client shows success and redirects /dashboard]

    BE2 --> B23[Client shows error and resumes scanning]
```

## 5. Admin Operational Flow

```mermaid
flowchart TD
    A0([Admin in /admin]) --> A1{Choose module}

    A1 --> K1[Key + Locker Management]
    K1 --> K2[GET /api/admin/keys, GET /api/lockers]
    K2 --> K3[POST/PUT/DELETE /api/keys]
    K2 --> K4[POST/DELETE /api/lockers]

    A1 --> Q1[QR Management]
    Q1 --> Q2[POST /api/qrcodes/generate]
    Q2 --> Q3[Store one unified QR per key\nusable for borrow/return]
    Q3 --> Q4[Deactivate older QR variants for same key]
    Q1 --> Q5[GET /api/admin/qrcodes, POST /api/admin/qrcodes/:id/regenerate, DELETE /api/admin/qrcodes/:id]

    A1 --> U1[User/Admin Accounts]
    U1 --> U2[GET /api/admin/users, GET /api/admin/user-approvals]
    U2 --> U3[Approve/Reject/Reset Password/Delete Users]
    U1 --> U4[GET/POST/DELETE /api/admin/admins\nPOST /api/admin/admins/:id/reset-password]

    A1 --> O1[Operations and Monitoring]
    O1 --> O2[GET /api/admin/stats, /api/admin/transactions, /api/admin/logs]
    O1 --> O3[Announcements, Feedback, Lost Reports]
    O1 --> O4[GET/PUT /api/admin/maintenance]

    K3 --> D[(MongoDB)]
    K4 --> D
    Q5 --> D
    U4 --> D
    O4 --> D
```

## 6. No-Cloudflare Deployment Path

```mermaid
flowchart LR
    UserDevice[Teacher or Admin Device] -->|LAN or same host| AppHost[Node.js App\nPort 3000]
    AppHost -->|Mongoose| Mongo[(MongoDB)]

    note1[No Cloudflare Tunnel, no cloud reverse proxy in request path]
    UserDevice -.-> note1
```
