# Key Borrowing System Flowchart

This document presents a clean thesis-style flowchart set for the current implementation of the Key Borrowing System.
It reflects the current setup:

- direct local access in `Pure Fast Mode`
- live camera QR scanning
- email verification for teacher registration
- Node.js/Express backend with MongoDB
- ESP32 locker controller for physical unlock operations
- no reCAPTCHA in the active login and registration flow

Coverage note:

- Figures 1 to 8 describe the main operational flow of the system.
- Figures 9 to 11 describe supporting flows that are also part of the full implementation, including startup/configuration, password reset, and maintenance control.

## Figure 0. System Startup and Runtime Configuration

```mermaid
flowchart TD
    Z0([Operator runs launcher]) --> Z1[Read environment settings from public/.env]
    Z1 --> Z2[Detect local network and runtime mode]
    Z2 --> Z3[Start Node.js application server]
    Z3 --> Z4[Connect to MongoDB]
    Z4 --> Z5[Load local runtime configuration]
    Z5 --> Z6[Prepare local access URLs]
    Z6 --> Z7[Sync target settings for ESP32 controller]
    Z7 --> Z8([System ready for teacher and admin access])
```

## Figure 1. Overall System Architecture

```mermaid
flowchart LR
    T[Teacher Device<br/>Phone or PC Browser]
    A[Admin Device<br/>PC Browser]
    R[Local Router / LAN]
    APP[Application Host<br/>Node.js + Express Server]
    DB[(MongoDB Database)]
    MAIL[Email Service<br/>SMTP / Verification Code]
    ESP[ESP32 Locker Controller<br/>Hotspot + Local Controller]
    LOCK[Locker Solenoid / Physical Locker]

    T --> R
    A --> R
    R --> APP
    APP --> DB
    APP --> MAIL
    APP --> ESP
    ESP --> LOCK
```

## Figure 2. Deployment and Network Setup

```mermaid
flowchart TD
    PC[PC Hosting the System] --> ETH[Ethernet Connection]
    ETH --> ROUTER[Campus / Home Router]

    PHONE[Teacher Phone] --> WIFI[Router Wi-Fi]
    WIFI --> ROUTER

    ESP32[ESP32 Controller] --> STA[ESP Station Connection]
    STA --> ROUTER

    ROUTER --> SERVER[Local Web Application]
    SERVER --> DATABASE[(MongoDB)]

    SERVER --> CTRL[Locker Control Request]
    CTRL --> ESP32
```

## Figure 3. Teacher Account Registration and Approval Flow

```mermaid
flowchart TD
    S([Start]) --> R1[Teacher opens Create Account page]
    R1 --> R2[Enter first name, last name, email, and password]
    R2 --> R3[Submit registration form]
    R3 --> R4[Server validates input]

    R4 -->|Invalid| R5[Show validation error]
    R4 -->|Valid| R6[Generate verification code]
    R6 --> R7[Store pending teacher account in MongoDB]
    R7 --> R8[Send verification code to teacher email]
    R8 --> R9[Teacher enters verification code]
    R9 --> R10[Server verifies code]

    R10 -->|Incorrect or expired| R11[Show verification error]
    R10 -->|Correct| R12[Mark email as verified]
    R12 --> R13[Set approval status to pending]
    R13 --> R14[Admin reviews teacher account]

    R14 -->|Approved| R15[Teacher account activated]
    R14 -->|Rejected| R16[Teacher login blocked]

    R15 --> E1([End: Teacher can log in])
    R16 --> E2([End: Access denied])
```

## Figure 4. Login Flow for Teacher and Admin

```mermaid
flowchart TD
    L0([Open Login Page]) --> L1{Select User Type}

    L1 -->|Teacher| L2[Enter email and password]
    L2 --> L3[Send login request to server]
    L3 --> L4{Credentials and status valid?}
    L4 -->|No| L5[Show login error]
    L4 -->|Yes| L6[Create teacher token]
    L6 --> L7[Store session in browser]
    L7 --> L8[Redirect to Teacher Dashboard]

    L1 -->|Admin| L9[Enter username and password]
    L9 --> L10[Send admin login request]
    L10 --> L11{Credentials valid?}
    L11 -->|No| L12[Show login error]
    L11 -->|Yes| L13[Create admin token]
    L13 --> L14[Store session in browser]
    L14 --> L15[Redirect to Admin Dashboard]
```

## Figure 5. Borrow and Return Flow Through QR Scanning

```mermaid
flowchart TD
    B0([Teacher Dashboard]) --> B1{Choose Transaction}
    B1 -->|Borrow| B2[Open scan page for borrow]
    B1 -->|Return| B3[Open scan page for return]

    B2 --> B4[Start live camera scanner]
    B3 --> B4
    B4 --> B5[Read admin-generated QR code]
    B5 --> B6[Send QR payload to server]
    B6 --> B7[Server validates user, key, and action]

    B7 -->|Invalid| B8[Return error to scanner page]
    B8 --> B4

    B7 -->|Valid| B9[Update key status in MongoDB]
    B9 --> B10[Create transaction record]
    B10 --> B11[Write activity log]
    B11 --> B12[Resolve mapped hardware locker number]
    B12 --> B13[Send unlock request to ESP32]

    B13 --> B14{Unlock success?}
    B14 -->|No| B15[Retry or direct controller fallback]
    B15 --> B16[Finalize response]
    B14 -->|Yes| B16[Finalize response]

    B16 --> B17[Show success message]
    B17 --> B18[Redirect back to dashboard]
```

## Figure 6. ESP32 Locker Unlock Flow

```mermaid
flowchart TD
    U0([Server receives valid borrow/return result]) --> U1[Determine hardware lock number]
    U1 --> U2[Build local unlock URL]
    U2 --> U3[Send request to ESP32 /unlock]
    U3 --> U4[ESP32 receives lock parameter]
    U4 --> U5[ESP32 activates corresponding output]
    U5 --> U6[Locker opens physically]
    U6 --> U7[ESP32 returns success status]
    U7 --> U8[Server completes transaction response]
```

## Figure 7. Admin Operational Flow

```mermaid
flowchart TD
    A0([Admin Dashboard]) --> A1{Select Module}

    A1 --> A2[Manage Keys and Lockers]
    A1 --> A3[Manage QR Codes]
    A1 --> A4[Review Teacher Approvals]
    A1 --> A5[View Transactions and Logs]
    A1 --> A6[Manage Feedback, Reports, and Maintenance]

    A2 --> DB[(MongoDB)]
    A3 --> DB
    A4 --> DB
    A5 --> DB
    A6 --> DB
```

## Figure 8. End-to-End Operational Summary

```mermaid
flowchart LR
    USER[Teacher]
    SCAN[Live QR Scan]
    API[Application Server]
    DATA[(MongoDB)]
    ESP[ESP32]
    LOCKER[Locker]
    RESULT[Success Response]

    USER --> SCAN
    SCAN --> API
    API --> DATA
    API --> ESP
    ESP --> LOCKER
    API --> RESULT
    RESULT --> USER
```

## Figure 9. Password Reset Flow

```mermaid
flowchart TD
    P0([Teacher opens Login Page]) --> P1[Select Forgot Password]
    P1 --> P2[Enter registered email address]
    P2 --> P3[Send password reset request]
    P3 --> P4{Email exists and reset is allowed?}

    P4 -->|No| P5[Show response message]
    P4 -->|Yes| P6[Generate secure reset token]
    P6 --> P7[Send reset link through email]
    P7 --> P8[Teacher opens reset link]
    P8 --> P9[Enter new password]
    P9 --> P10[Server validates token and password]

    P10 -->|Invalid or expired| P11[Show reset error]
    P10 -->|Valid| P12[Update password hash in database]
    P12 --> P13([Teacher can log in with new password])
```

## Figure 10. Maintenance Control Flow

```mermaid
flowchart TD
    M0([Admin Dashboard]) --> M1[Open maintenance settings]
    M1 --> M2{Enable maintenance mode?}

    M2 -->|Yes| M3[Store maintenance state in MongoDB]
    M3 --> M4[Teacher operations are temporarily blocked]

    M2 -->|No| M5[Store normal system state]
    M5 --> M6[Teacher operations continue normally]

    M4 --> M7[Login-dependent pages can still show maintenance response]
    M6 --> M8([System available for normal use])
```

## Figure 11. Supporting Teacher and Admin Service Modules

```mermaid
flowchart LR
    TEACHER[Teacher Portal]
    ADMIN[Admin Portal]
    API[Application Server]
    DB[(MongoDB)]

    TEACHER --> F1[Feedback Submission]
    TEACHER --> F2[Lost Key Report]
    TEACHER --> F3[Profile Update]
    TEACHER --> F4[Announcements View]

    ADMIN --> A1[Approval Review]
    ADMIN --> A2[Key and Locker Management]
    ADMIN --> A3[QR Code Management]
    ADMIN --> A4[Feedback and Lost Report Handling]
    ADMIN --> A5[Announcements and Maintenance]
    ADMIN --> A6[Statistics, Transactions, and Logs]

    F1 --> API
    F2 --> API
    F3 --> API
    F4 --> API
    A1 --> API
    A2 --> API
    A3 --> API
    A4 --> API
    A5 --> API
    A6 --> API

    API --> DB
```

## Recommended Use in Thesis

For a thesis document, it is usually better not to force the entire system into one oversized diagram.
The cleaner and more academically acceptable approach is:

1. Use Figure 1 as the architectural overview.
2. Use Figures 3 to 8 as the main transaction and control flows.
3. Use Figures 9 to 11 as supporting operational flows.

This means the file now covers both:

- the core system flow
- the important supporting flows that exist in the actual implementation

## Suggested Thesis Caption Text

You may use the following short caption under the diagram set:

> The Key Borrowing System uses a local web-based client-server architecture where teachers and administrators access the application through a browser, transactions are processed by a Node.js and Express backend, records are stored in MongoDB, and validated QR transactions trigger an ESP32-based locker controller for physical key access.
