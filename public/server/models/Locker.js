const mongoose = require('mongoose');

const lockerSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    hardwareLockNumber: {
        type: Number,
        min: 1,
        index: true
    }
}, {
    timestamps: true
});

lockerSchema.index({ name: 1 }, { unique: true });
lockerSchema.index(
    { hardwareLockNumber: 1 },
    {
        unique: true,
        partialFilterExpression: { hardwareLockNumber: { $type: 'number' } }
    }
);

module.exports = mongoose.model('Locker', lockerSchema);
