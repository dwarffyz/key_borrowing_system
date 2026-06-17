/* eslint-disable no-console */
const path = require('path');
const readline = require('readline');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const Admin = require('../models/Admin');
const User = require('../models/User');
const Key = require('../models/Key');
const Locker = require('../models/Locker');
const Transaction = require('../models/Transaction');
const QRCodeModel = require('../models/QRCode');
const ActivityLog = require('../models/ActivityLog');
const Feedback = require('../models/Feedback');

const CONFIRM_STRING = 'RESET_DATABASE';

const DEFAULT_ADMIN = {
    username: process.env.ADMIN_USERNAME || 'CPETadmin',
    password: process.env.ADMIN_PASSWORD || 'admin123!',
    email: process.env.ADMIN_EMAIL || 'admin@batstateu.edu.ph',
    fullName: process.env.ADMIN_FULL_NAME || 'System Administrator'
};

const normalizeIdentity = (value) => String(value || '').trim().toLowerCase();
const DEFAULT_ADMIN_USERNAME_NORM = normalizeIdentity(DEFAULT_ADMIN.username);
const DEFAULT_ADMIN_EMAIL_NORM = normalizeIdentity(DEFAULT_ADMIN.email);

const maskMongoUri = (uri) => {
    try {
        const parsed = new URL(uri);
        if (parsed.password) parsed.password = '***';
        return parsed.toString();
    } catch {
        return String(uri || '').replace(/\/\/([^:/?#]+):([^@/]+)@/g, '//$1:***@');
    }
};

const deriveLockerFromKeyId = (keyId) => {
    const match = /^KEY(\d{3})$/i.exec(String(keyId || '').trim());
    if (!match) return '';
    const num = Number(match[1]);
    if (!Number.isFinite(num) || num <= 0) return '';
    return `Locker ${Math.ceil(num / 15)}`;
};

const envFlag = (value, defaultValue = false) => {
    if (value === undefined) return defaultValue;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    return defaultValue;
};

const parseArgs = (argv) => {
    const args = { _: [] };

    argv.forEach((raw) => {
        const value = String(raw || '');
        if (!value.startsWith('--')) {
            args._.push(value);
            return;
        }

        const [, keyPart] = value.split(/^--/);
        if (!keyPart) return;

        const [key, assigned] = keyPart.split('=');
        if (assigned !== undefined) {
            args[key] = assigned;
            return;
        }

        args[key] = true;
    });

    // handle --mode factory (without equals)
    for (let i = 0; i < argv.length; i += 1) {
        const current = String(argv[i] || '');
        if (current === '--mode' && argv[i + 1] && !String(argv[i + 1]).startsWith('--')) {
            args.mode = argv[i + 1];
        }
        if (current === '--confirm' && argv[i + 1] && !String(argv[i + 1]).startsWith('--')) {
            args.confirm = argv[i + 1];
        }
    }

    return args;
};

const printHelp = () => {
    console.log('');
    console.log('Key Borrowing System - DB Reset Tool');
    console.log('');
    console.log('Usage:');
    console.log('  node public/server/scripts/reset-db.js --mode test');
    console.log('  node public/server/scripts/reset-db.js --mode factory');
    console.log('');
    console.log('Options:');
    console.log('  --mode <test|factory>   Reset mode (default: test)');
    console.log('  --dry-run               Show what will be deleted and exit');
    console.log('  --yes                   Skip interactive prompt (requires --confirm)');
    console.log(`  --confirm ${CONFIRM_STRING}  Required when using --yes`);
    console.log('  --help                  Show help');
    console.log('');
    console.log('Modes:');
    console.log('  test    Deletes users/logs/transactions/feedback/qrcodes; resets keys to AVAILABLE; keeps keys/lockers.');
    console.log('  factory Same as test + deletes keys/lockers and recreates default keys/lockers.');
    console.log('');
};

const ask = async (question) => new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
        rl.close();
        resolve(String(answer || ''));
    });
});

const connectDb = async (mongoUri) => {
    await mongoose.connect(mongoUri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000
    });
};

const ensureDefaultAdmin = async () => {
    const desiredPermissions = {
        manageKeys: true,
        manageUsers: true,
        manageAdmins: true,
        generateReports: true,
        systemSettings: true
    };

    const byUsername = DEFAULT_ADMIN.username
        ? await Admin.findOne({ username: new RegExp(`^${DEFAULT_ADMIN.username.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}$`, 'i') })
        : null;

    const byEmail = !byUsername && DEFAULT_ADMIN.email
        ? await Admin.findOne({ email: new RegExp(`^${DEFAULT_ADMIN.email.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}$`, 'i') })
        : null;

    let defaultAdmin = byUsername || byEmail;

    if (!defaultAdmin) {
        defaultAdmin = new Admin({
            username: DEFAULT_ADMIN.username,
            password: DEFAULT_ADMIN.password,
            email: DEFAULT_ADMIN.email,
            fullName: DEFAULT_ADMIN.fullName,
            role: 'super_admin',
            permissions: desiredPermissions,
            isActive: true,
            isDefault: true
        });
        await defaultAdmin.save();
        return { created: true, updated: false, defaultAdmin };
    }

    let shouldSave = false;
    let resetPasswordToEnv = false;

    if (defaultAdmin.username !== DEFAULT_ADMIN.username) {
        defaultAdmin.username = DEFAULT_ADMIN.username;
        shouldSave = true;
    }

    if (defaultAdmin.email !== DEFAULT_ADMIN.email) {
        defaultAdmin.email = DEFAULT_ADMIN.email;
        shouldSave = true;
    }

    if (defaultAdmin.fullName !== DEFAULT_ADMIN.fullName) {
        defaultAdmin.fullName = DEFAULT_ADMIN.fullName;
        shouldSave = true;
    }

    if (defaultAdmin.isDefault !== true) {
        defaultAdmin.isDefault = true;
        shouldSave = true;
    }

    if (defaultAdmin.isActive === false) {
        defaultAdmin.isActive = true;
        shouldSave = true;
    }

    if (defaultAdmin.role !== 'super_admin') {
        defaultAdmin.role = 'super_admin';
        shouldSave = true;
    }

    if (!defaultAdmin.permissions) {
        defaultAdmin.permissions = {};
        shouldSave = true;
    }

    Object.keys(desiredPermissions).forEach((key) => {
        if (defaultAdmin.permissions[key] !== true) {
            defaultAdmin.permissions[key] = true;
            shouldSave = true;
        }
    });

    if (process.env.NODE_ENV !== 'production') {
        const matchesDefault = await bcrypt.compare(DEFAULT_ADMIN.password, defaultAdmin.password);
        if (!matchesDefault) {
            defaultAdmin.password = DEFAULT_ADMIN.password;
            resetPasswordToEnv = true;
            shouldSave = true;
        }
    }

    if (shouldSave) {
        await defaultAdmin.save();
    }

    return { created: false, updated: shouldSave, resetPasswordToEnv, defaultAdmin };
};

const pruneAdminsToDefault = async () => {
    const usernameNorm = DEFAULT_ADMIN_USERNAME_NORM;
    const emailNorm = DEFAULT_ADMIN_EMAIL_NORM;

    const admins = await Admin.find().select('_id username email isDefault');
    const keepIds = new Set();

    for (const admin of admins) {
        const matchesEnvUsername = usernameNorm && normalizeIdentity(admin.username) === usernameNorm;
        const matchesEnvEmail = emailNorm && normalizeIdentity(admin.email) === emailNorm;
        if (admin.isDefault === true || matchesEnvUsername || matchesEnvEmail) {
            keepIds.add(String(admin._id));
        }
    }

    if (keepIds.size === 0) {
        // Nothing to keep; we'll recreate default admin.
        await Admin.deleteMany({});
        return { deleted: admins.length, kept: 0 };
    }

    const deleteResult = await Admin.deleteMany({ _id: { $nin: Array.from(keepIds) } });
    return { deleted: deleteResult.deletedCount || 0, kept: keepIds.size };
};

const resetKeysToAvailable = async () => {
    return Key.updateMany(
        {},
        {
            $set: {
                status: 'available',
                borrowedBy: null,
                borrowedAt: null,
                qrCode: null
            }
        }
    );
};

const initializeDefaultKeys = async () => {
    const keyCount = await Key.countDocuments();
    if (keyCount !== 0) return { created: 0 };

    const keys = [];
    for (let i = 1; i <= 30; i += 1) {
        const keyId = `KEY${i.toString().padStart(3, '0')}`;
        keys.push({
            keyId,
            locker: deriveLockerFromKeyId(keyId),
            room: `Room ${i}`,
            building: 'Main Building',
            description: `Default key for Room ${i}`,
            status: 'available'
        });
    }

    await Key.insertMany(keys);
    return { created: keys.length };
};

const initializeDefaultLockers = async () => {
    const lockerNames = await Key.distinct('locker', { locker: { $nin: [null, ''] } });
    const uniqueNames = (lockerNames || [])
        .map((name) => String(name || '').trim())
        .filter(Boolean);

    if (uniqueNames.length === 0) return { created: 0 };

    const existing = await Locker.find({ name: { $in: uniqueNames } }).select('name');
    const existingSet = new Set((existing || []).map((l) => String(l.name || '')));

    const toCreate = uniqueNames
        .filter((name) => !existingSet.has(name))
        .map((name) => ({ name }));

    if (toCreate.length === 0) return { created: 0 };

    try {
        await Locker.insertMany(toCreate, { ordered: false });
    } catch (error) {
        if (error && error.code !== 11000) throw error;
    }

    return { created: toCreate.length };
};

const main = async () => {
    const args = parseArgs(process.argv.slice(2));

    if (args.help) {
        printHelp();
        process.exit(0);
    }

    const mode = String(args.mode || 'test').trim().toLowerCase();
    const dryRun = args['dry-run'] === true || String(args['dry-run'] || '').toLowerCase() === 'true';
    const yes = args.yes === true || String(args.yes || '').toLowerCase() === 'true';
    const confirm = String(args.confirm || '').trim();

    const modes = new Set(['test', 'factory']);
    if (!modes.has(mode)) {
        console.error(`❌ Invalid --mode "${mode}". Use "test" or "factory".`);
        printHelp();
        process.exit(1);
    }

    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/key_borrowing_system';

    console.log('============================================');
    console.log('DB RESET TOOL (DESTRUCTIVE)');
    console.log('============================================');
    console.log(`Mode: ${mode}`);
    console.log(`MongoDB: ${maskMongoUri(mongoUri)}`);
    console.log('');

    if (dryRun) {
        console.log('Dry run only. No data will be deleted.');
        console.log('');
        console.log('This will:');
        console.log('- Delete ALL teacher/user accounts');
        console.log('- Delete ALL activity logs');
        console.log('- Delete ALL transactions');
        console.log('- Delete ALL feedback entries');
        console.log('- Delete ALL QR codes');
        console.log('- Keep ONLY the default admin from public/.env (removes other admins)');
        if (mode === 'test') {
            console.log('- Reset all keys to AVAILABLE (keeps keys/lockers)');
        } else {
            console.log('- Delete ALL keys and lockers, then recreate default keys/lockers');
        }
        process.exit(0);
    }

    if (yes) {
        if (confirm !== CONFIRM_STRING) {
            console.error(`❌ Missing/invalid --confirm. Use: --confirm ${CONFIRM_STRING}`);
            process.exit(1);
        }
    } else {
        console.log('This will permanently delete data from your database.');
        console.log('Tip: Stop your server first to avoid weird errors while data is being wiped.');
        console.log('');
        const answer = (await ask(`Type ${CONFIRM_STRING} to continue, or anything else to cancel: `)).trim();
        if (answer !== CONFIRM_STRING) {
            console.log('Cancelled.');
            process.exit(0);
        }
    }

    const allowInProduction = envFlag(process.env.ALLOW_DB_RESET_IN_PRODUCTION, false);
    if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production' && !allowInProduction) {
        console.error('❌ Refusing to reset DB in production.');
        console.error('Set ALLOW_DB_RESET_IN_PRODUCTION=true in public/.env if you really want to allow this.');
        process.exit(1);
    }

    await connectDb(mongoUri);
    console.log('✅ Connected to MongoDB');

    try {
        const deleteResults = {};

        deleteResults.transactions = await Transaction.deleteMany({});
        deleteResults.feedback = await Feedback.deleteMany({});
        deleteResults.qrcodes = await QRCodeModel.deleteMany({});
        deleteResults.activityLogs = await ActivityLog.deleteMany({});
        deleteResults.users = await User.deleteMany({});

        if (mode === 'factory') {
            deleteResults.keys = await Key.deleteMany({});
            deleteResults.lockers = await Locker.deleteMany({});
        } else {
            deleteResults.keysReset = await resetKeysToAvailable();
        }

        deleteResults.adminsPruned = await pruneAdminsToDefault();
        const defaultAdminResult = await ensureDefaultAdmin();

        if (mode === 'factory') {
            deleteResults.defaultKeys = await initializeDefaultKeys();
            deleteResults.defaultLockers = await initializeDefaultLockers();
        }

        console.log('');
        console.log('✅ Reset complete.');
        console.log('');
        console.log('Summary:');
        console.log(`- Users deleted: ${deleteResults.users.deletedCount || 0}`);
        console.log(`- Activity logs deleted: ${deleteResults.activityLogs.deletedCount || 0}`);
        console.log(`- Transactions deleted: ${deleteResults.transactions.deletedCount || 0}`);
        console.log(`- Feedback deleted: ${deleteResults.feedback.deletedCount || 0}`);
        console.log(`- QR codes deleted: ${deleteResults.qrcodes.deletedCount || 0}`);
        if (mode === 'factory') {
            console.log(`- Keys deleted: ${deleteResults.keys.deletedCount || 0}`);
            console.log(`- Lockers deleted: ${deleteResults.lockers.deletedCount || 0}`);
            console.log(`- Default keys created: ${deleteResults.defaultKeys.created || 0}`);
            console.log(`- Default lockers created: ${deleteResults.defaultLockers.created || 0}`);
        } else {
            console.log(`- Keys reset to available: ${deleteResults.keysReset.modifiedCount || 0}`);
        }
        console.log(`- Other admins removed: ${deleteResults.adminsPruned.deleted || 0}`);
        console.log(`- Default admin: ${defaultAdminResult.defaultAdmin?.username || DEFAULT_ADMIN.username} (${defaultAdminResult.created ? 'created' : 'kept'})`);
    } finally {
        await mongoose.disconnect();
    }
};

main().catch((error) => {
    console.error('❌ Reset failed:', error);
    process.exit(1);
});

