# 🏛️ BatStateU Key Borrowing System

A comprehensive key management platform with QR code generation and scanning for Batangas State University.

## 🚀 Features

### 🔐 Authentication System
- Separate login for Teachers and Administrators
- Secure JWT-based authentication
- Password hashing with bcrypt
- Role-based access control

### 🔑 Key Management
- Add, edit, delete, and track keys
- Real-time status monitoring (Available/Borrowed/Lost/Maintenance)
- Room and building assignment
- Detailed key descriptions

### 📱 QR Code System
- Generate unique QR codes for each key
- QR codes expire after 7 days
- Scan QR codes using camera
- Download and print QR codes
- Track QR code usage history

### 📊 Dashboard & Analytics
- Real-time statistics and charts
- Activity logs and transaction history
- User-friendly admin panel
- Responsive design for all devices

### 🔄 Borrow/Return System
- Simple borrowing process
- Automatic return tracking
- Manual entry option
- Complete transaction history
- Optional ESP32 locker controller trigger before marking a key as borrowed/returned

## 🛠️ Installation

### Prerequisites
- Node.js (v16 or higher)
- MongoDB (v4.4 or higher)
- npm or yarn

### Quick Setup

#### Windows:
1. Double-click `setup.bat`
2. Follow the on-screen instructions

## Local ESP WiFi Mode

If you want phones to use the full system over the ESP WiFi without internet:

1. Connect the laptop to the ESP WiFi.
2. Double-click `start-local-system.bat` in the project root.
3. Keep the laptop running. The launcher starts MongoDB, starts the Node server, and saves usable access URLs to `.tools/local-system-urls.txt`.
4. Connect phones to the same ESP WiFi and open the laptop URL shown by the launcher, such as `http://192.168.x.x:3000`.

Notes:
- The full website still runs on the laptop, not on the ESP32 itself.
- On mobile local HTTP connections, live camera access can be blocked by the browser. The scan page now includes an `Upload QR Photo` fallback so users can still scan QR codes while on the ESP WiFi.

#### Linux/Mac:
```bash
chmod +x setup.sh
./setup.sh
