const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    keyId: {
        type: String,
        required: true,
        ref: 'Key'
    },
    locker: {
        type: String,
        trim: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User'
    },
    action: {
        type: String,
        enum: ['borrow', 'return'],
        required: true
    },
    qrCodeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'QRCode'
    },
    location: {
        type: String,
        trim: true
    },
    notes: {
        type: String,
        trim: true
    },
    scannedBy: {
        type: String,
        enum: ['qr', 'manual', 'admin'],
        default: 'qr'
    },
    performedAt: {
        type: Date,
        default: Date.now
    },
    sessionId: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

// Index for faster queries
transactionSchema.index({ keyId: 1 });
transactionSchema.index({ locker: 1 });
transactionSchema.index({ userId: 1 });
transactionSchema.index({ createdAt: -1 });
transactionSchema.index({ performedAt: -1 });
transactionSchema.index({ action: 1 });
transactionSchema.index({ sessionId: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
