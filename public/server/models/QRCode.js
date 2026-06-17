const mongoose = require('mongoose');

const qrCodeSchema = new mongoose.Schema({
    keyId: {
        type: String,
        required: true,
        ref: 'Key'
    },
    room: {
        type: String,
        required: true
    },
    purpose: {
        type: String,
        enum: ['borrow', 'return', 'verification', 'unified', 'auto', 'auto_borrow_return', 'auto-borrow-return'],
        default: 'unified'
    },
    qrData: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    qrCodeImage: {
        type: String,
        required: true
    },
    generatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin',
        required: true
    },
    used: {
        type: Boolean,
        default: false
    },
    usedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    usedAt: {
        type: Date
    },
    expiresAt: {
        type: Date,
        required: true
    },
    regeneratedAt: {
        type: Date
    },
    regeneratedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin'
    }
}, {
    timestamps: true
});

// Index for faster queries
qrCodeSchema.index({ keyId: 1 });
qrCodeSchema.index({ expiresAt: 1 });
qrCodeSchema.index({ used: 1 });
qrCodeSchema.index({ generatedBy: 1 });

// Check if QR code is expired
qrCodeSchema.methods.isExpired = function() {
    return new Date() > this.expiresAt;
};

module.exports = mongoose.model('QRCode', qrCodeSchema);
