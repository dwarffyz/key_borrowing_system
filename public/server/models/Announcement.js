const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['notification', 'popup'],
        default: 'notification',
        required: true
    },
    title: {
        type: String,
        trim: true,
        default: ''
    },
    message: {
        type: String,
        trim: true,
        default: ''
    },
    imageDataUrl: {
        type: String,
        default: ''
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin'
    },
    createdByName: {
        type: String,
        trim: true,
        default: ''
    },
    active: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

announcementSchema.index({ type: 1, active: 1, createdAt: -1 });

module.exports = mongoose.model('Announcement', announcementSchema);

