const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
    message: {
        type: String,
        required: true,
        trim: true,
        maxlength: 2000
    },
    anonymous: {
        type: Boolean,
        default: true
    },
    email: {
        type: String,
        trim: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    isRead: {
        type: Boolean,
        default: false
    },
    readAt: {
        type: Date
    }
}, {
    timestamps: true
});

feedbackSchema.index({ createdAt: -1 });
feedbackSchema.index({ isRead: 1 });
feedbackSchema.index({ email: 1 });

module.exports = mongoose.model('Feedback', feedbackSchema);

