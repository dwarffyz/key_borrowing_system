const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
    actorType: {
        type: String,
        enum: ['admin', 'user', 'system'],
        default: 'system'
    },
    actorId: {
        type: mongoose.Schema.Types.ObjectId
    },
    actorName: {
        type: String,
        trim: true
    },
    action: {
        type: String,
        required: true,
        trim: true
    },
    targetType: {
        type: String,
        trim: true
    },
    targetId: {
        type: mongoose.Schema.Types.ObjectId
    },
    targetName: {
        type: String,
        trim: true
    },
    details: {
        type: mongoose.Schema.Types.Mixed
    }
}, {
    timestamps: true
});

activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ action: 1 });
activityLogSchema.index({ actorName: 1 });
activityLogSchema.index({ targetName: 1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
