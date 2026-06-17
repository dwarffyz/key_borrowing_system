const mongoose = require('mongoose');

const keySchema = new mongoose.Schema({
    keyId: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true,
        match: [/^KEY\d{3}$/, 'Key ID must be in format KEY001 to KEY999']
    },
    locker: {
        type: String,
        trim: true
    },
    room: {
        type: String,
        required: true,
        trim: true
    },
    building: {
        type: String,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    status: {
        type: String,
        enum: ['available', 'borrowed', 'lost', 'maintenance'],
        default: 'available'
    },
    borrowedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    borrowedAt: {
        type: Date
    },
    currentBorrowSessionId: {
        type: String,
        trim: true
    },
    qrCode: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'QRCode'
    },
    lastMaintenance: {
        type: Date
    },
    notes: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

// Index for faster queries
keySchema.index({ keyId: 1 });
keySchema.index({ locker: 1 });
keySchema.index({ status: 1 });
keySchema.index({ borrowedBy: 1 });
keySchema.index({ currentBorrowSessionId: 1 });

module.exports = mongoose.model('Key', keySchema);
