const mongoose = require('mongoose');

const maintenanceSchema = new mongoose.Schema({
    scope: {
        type: String,
        trim: true,
        default: 'global',
        unique: true,
        index: true
    },
    enabled: {
        type: Boolean,
        default: false
    },
    title: {
        type: String,
        trim: true,
        default: 'System Maintenance'
    },
    message: {
        type: String,
        trim: true,
        default: ''
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin',
        default: null
    },
    updatedByName: {
        type: String,
        trim: true,
        default: ''
    }
}, {
    timestamps: true
});

maintenanceSchema.index({ scope: 1 }, { unique: true });

module.exports = mongoose.model('Maintenance', maintenanceSchema);

