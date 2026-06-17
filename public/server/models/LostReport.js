const mongoose = require('mongoose');

const lostReportSchema = new mongoose.Schema({
    keyId: {
        type: String,
        required: true,
        uppercase: true,
        trim: true,
        match: [/^KEY\d{3}$/, 'Key ID must be in format KEY001 to KEY999']
    },
    locker: {
        type: String,
        trim: true,
        default: ''
    },
    room: {
        type: String,
        trim: true,
        default: ''
    },
    building: {
        type: String,
        trim: true,
        default: ''
    },
    message: {
        type: String,
        trim: true,
        maxlength: 800,
        default: ''
    },
    status: {
        type: String,
        enum: ['pending', 'resolved', 'open'],
        default: 'pending',
        index: true
    },
    reportedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    reportedByEmail: {
        type: String,
        trim: true,
        lowercase: true,
        default: '',
        index: true
    },
    adminReadAt: {
        type: Date,
        default: null,
        index: true
    },
    adminReadBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin',
        default: null
    },
    adminReadByName: {
        type: String,
        trim: true,
        default: ''
    },
    adminReply: {
        type: String,
        trim: true,
        maxlength: 1200,
        default: ''
    },
    adminRepliedAt: {
        type: Date,
        default: null
    },
    adminRepliedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin',
        default: null
    },
    adminRepliedByName: {
        type: String,
        trim: true,
        default: ''
    },
    resolvedAt: {
        type: Date,
        default: null
    },
    resolvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin',
        default: null
    },
    resolutionNote: {
        type: String,
        trim: true,
        maxlength: 400,
        default: ''
    }
}, {
    timestamps: true
});

lostReportSchema.index({ keyId: 1, createdAt: -1 });
lostReportSchema.index({ status: 1, createdAt: -1 });
lostReportSchema.index({ adminReadAt: 1, createdAt: -1 });

module.exports = mongoose.model('LostReport', lostReportSchema);
