require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const mongoose = require('mongoose');
const axios = require('axios');
const cookieParser = require('cookie-parser');

const app = express();

app.set('trust proxy', 1);
app.use(cookieParser());

const SUPPORTED_LANGS = ['es', 'en', 'pt', 'fr', 'hi', 'ar', 'zh'];

function loadTranslations(lang) {
    const selected = SUPPORTED_LANGS.includes(lang) ? lang : 'es';
    try {
        const filePath = path.join(__dirname, 'locales', `${selected}.json`);
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        if (selected !== 'es') return loadTranslations('es');
        return {};
    }
}

function resolveLang(req, res) {
    const raw = req.query.lang || req.cookies.lang || 'es';
    const lang = SUPPORTED_LANGS.includes(raw) ? raw : 'es';
    res.cookie('lang', lang, { maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax', httpOnly: false });
    return lang;
}

// Conexión a MongoDB (protegida para que no tumbe la web si falla)
mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI)
    .then(() => console.log('Conectado a MongoDB exitosamente'))
    .catch(err => console.error('Error al conectar a MongoDB:', err));

async function checkAndGrantBadges(user, userData) {
    if (!userData) return [];
    
    let changed = false;
    const newBadges = new Set(userData.badges || []);
    
    // Lista de reglas: ID insignia, Condición
    const rules = [
        { id: 'Leyenda', condition: userData.level >= 100 },
        { id: 'Activo', condition: userData.songs >= 500 },
        { id: 'Fundador', condition: false }, // Manual
        { id: 'Arquitecto de Bot', condition: false }, // Manual
        { id: 'Impulsor Estrella', condition: false }, // Integrar con API Top.gg
        { id: 'Comandante', condition: userData.songs >= 1000 },
        { id: 'Guardián', condition: false }, // Manual
        { id: 'Premium', condition: false } // Integrar con sistema de pagos
    ];
    
    rules.forEach(rule => {
        if (rule.condition && !newBadges.has(rule.id)) {
            newBadges.add(rule.id);
            changed = true;
        }
    });
    
    if (changed) {
        userData.badges = Array.from(newBadges);
        await UserModel.findOneAndUpdate(
            { userId: user.id },
            { $set: { badges: userData.badges } }
        );
    }
    return userData.badges;
}

const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    money: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    songs: { type: Number, default: 0 },
    xp: { type: Number, default: 0 },
    badges: { type: [String], default: [] }
});

const UserModel = mongoose.model('User', userSchema);

const statsSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    totalCommands: { type: Number, default: 0 }
});
const StatsModel = mongoose.model('Stats', statsSchema);

// Schema para Notificaciones
const notificationSchema = new mongoose.Schema({
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: { type: String, enum: ['info', 'warning', 'error', 'success'], default: 'info' },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    createdBy: { type: String, required: true } // ID del admin que creó la notificación
});
const NotificationModel = mongoose.model('Notification', notificationSchema);

// Schema para Historial de Notificaciones Eliminadas
const deletedNotificationSchema = new mongoose.Schema({
    originalNotification: { type: mongoose.Schema.Types.ObjectId, ref: 'Notification' },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: { type: String, required: true },
    deletedAt: { type: Date, default: Date.now },
    deletedBy: { type: String, required: true } // ID del admin que eliminó la notificación
});
const DeletedNotificationModel = mongoose.model('DeletedNotification', deletedNotificationSchema);

// Schema para Administradores
const adminSchema = new mongoose.Schema({
    discordId: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    permissionLevel: { type: String, enum: ['manager', 'admin', 'moderator'], default: 'admin' },
    grantedBy: { type: String },
    grantedAt: { type: Date, default: Date.now }
});
const AdminModel = mongoose.model('Admin', adminSchema);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

client.commands = new Collection();
try {
    const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const command = require(`./commands/${file}`);
        client.commands.set(command.data.name, command);
    }
} catch (e) {
    console.log("No se cargaron comandos locales o la carpeta no existe.");
}

app.use(session({
    secret: process.env.SESSION_SECRET || 'secreto_super_seguro_para_sesiones',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
        secure: true, // Obligatorio en Railway al usar HTTPS tras un proxy
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 días de persistencia de sesión
    }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => {
    done(null, obj);
 });
passport.use(new DiscordStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL, 
    scope: ['identify', 'guilds'],
    passReqToCallback: true
}, (req, accessToken, refreshToken, profile, done) => {
    profile.accessToken = accessToken;
    return done(null, profile);
}));

app.set('view engine', 'ejs');
app.set('views', path.resolve('./views'));
app.use(express.static(path.join(__dirname, 'public')));

// Rutas de Autenticación con Discord
app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback', 
    passport.authenticate('discord', { failureRedirect: '/' }), 
    (req, res) => {
        res.redirect('/dashboard');
    }
);

app.get('/logout', (req, res, next) => { 
    req.logout((err) => { 
        if (err) return next(err); 
        res.redirect('/'); 
    }); 
});

// Ruta API para las estadísticas en tiempo real
app.get('/api/stats', async (req, res) => {
    try {
        const totalServers = client.guilds.cache.size;
        const totalUsers = client.guilds.cache.reduce((acc, guild) => acc + (guild.memberCount || 0), 0);
        
        let statsDoc = await StatsModel.findOne({ key: 'global_stats' });
        const totalCommands = statsDoc ? statsDoc.totalCommands : 0;
        
        res.json({
            servers: totalServers,
            users: totalUsers,
            commands: totalCommands
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
});

// API para crear notificación global
app.post('/api/notifications', async (req, res) => {
    try {
        if (!req.isAuthenticated()) return res.status(401).json({ error: "No autorizado" });
        
        // Validación estricta: Solo el Manager autorizado puede crear notificaciones
        const MANAGER_ID = process.env.MANAGER_ID;
        if (req.user.id !== MANAGER_ID) {
            return res.status(403).json({ error: "Acceso denegado. No tienes permisos de Manager." });
        }
        
        const { title, message, type } = req.body;
        const notification = new NotificationModel({
            title,
            message,
            type: type || 'info',
            createdBy: req.user.id
        });
        
        await notification.save();
        res.json({ success: true, notification });
    } catch (error) {
        console.error("Error al crear notificación:", error);
        res.status(500).json({ error: "Error al crear notificación" });
    }
});

// API para obtener notificaciones activas
app.get('/api/notifications', async (req, res) => {
    try {
        const notifications = await NotificationModel.find({ isActive: true }).sort({ createdAt: -1 });
        res.json({ notifications });
    } catch (error) {
        console.error("Error al obtener notificaciones:", error);
        res.status(500).json({ error: "Error al obtener notificaciones" });
    }
});

// API para eliminar notificación
app.delete('/api/notifications/:id', async (req, res) => {
    try {
        if (!req.isAuthenticated()) return res.status(401).json({ error: "No autorizado" });
        
        // Validación estricta: Solo el Manager autorizado puede eliminar notificaciones
        const MANAGER_ID = process.env.MANAGER_ID;
        if (req.user.id !== MANAGER_ID) {
            return res.status(403).json({ error: "Acceso denegado. No tienes permisos de Manager." });
        }
        
        const notification = await NotificationModel.findById(req.params.id);
        if (!notification) return res.status(404).json({ error: "Notificación no encontrada" });
        
        // Crear registro en historial de eliminadas
        const deletedNotification = new DeletedNotificationModel({
            originalNotification: notification._id,
            title: notification.title,
            message: notification.message,
            type: notification.type,
            deletedBy: req.user.id
        });
        await deletedNotification.save();
        
        // Marcar como inactiva en lugar de eliminar
        notification.isActive = false;
        await notification.save();
        
        res.json({ success: true });
    } catch (error) {
        console.error("Error al eliminar notificación:", error);
        res.status(500).json({ error: "Error al eliminar notificación" });
    }
});

// API para obtener historial de notificaciones eliminadas
app.get('/api/notifications/deleted', async (req, res) => {
    try {
        if (!req.isAuthenticated()) return res.status(401).json({ error: "No autorizado" });
        
        const deletedNotifications = await DeletedNotificationModel.find().sort({ deletedAt: -1 });
        res.json({ deletedNotifications });
    } catch (error) {
        console.error("Error al obtener historial:", error);
        res.status(500).json({ error: "Error al obtener historial" });
    }
});

// API para obtener administradores
app.get('/api/admins', async (req, res) => {
    try {
        if (!req.isAuthenticated()) return res.status(401).json({ error: "No autorizado" });
        
        const admins = await AdminModel.find().sort({ grantedAt: -1 });
        res.json({ admins });
    } catch (error) {
        console.error("Error al obtener administradores:", error);
        res.status(500).json({ error: "Error al obtener administradores" });
    }
});

// API para otorgar permisos de administrador
app.post('/api/admins', async (req, res) => {
    try {
        if (!req.isAuthenticated()) return res.status(401).json({ error: "No autorizado" });
        
        // Validación estricta: Solo el Manager autorizado puede otorgar permisos
        const MANAGER_ID = process.env.MANAGER_ID;
        if (req.user.id !== MANAGER_ID) {
            return res.status(403).json({ error: "Acceso denegado. No tienes permisos de Manager." });
        }
        
        const { discordId, username, permissionLevel } = req.body;
        
        // Validar formato de ID de Discord (debe ser un número de 18-19 dígitos)
        const discordIdRegex = /^\d{17,19}$/;
        if (!discordIdRegex.test(discordId)) {
            return res.status(400).json({ error: "ID de Discord inválido" });
        }
        
        const admin = new AdminModel({
            discordId,
            username,
            permissionLevel,
            grantedBy: req.user.id
        });
        
        await admin.save();
        res.json({ success: true, admin });
    } catch (error) {
        console.error("Error al otorgar permisos:", error);
        if (error.code === 11000) {
            return res.status(400).json({ error: "El usuario ya es administrador" });
        }
        res.status(500).json({ error: "Error al otorgar permisos" });
    }
});

// API para revocar permisos de administrador
app.delete('/api/admins/:discordId', async (req, res) => {
    try {
        if (!req.isAuthenticated()) return res.status(401).json({ error: "No autorizado" });
        
        // Validación estricta: Solo el Manager autorizado puede revocar permisos
        const MANAGER_ID = process.env.MANAGER_ID;
        if (req.user.id !== MANAGER_ID) {
            return res.status(403).json({ error: "Acceso denegado. No tienes permisos de Manager." });
        }
        
        const result = await AdminModel.deleteOne({ discordId: req.params.discordId });
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: "Administrador no encontrado" });
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error("Error al revocar permisos:", error);
        res.status(500).json({ error: "Error al revocar permisos" });
    }
});

// API para exportar los datos del usuario (GDPR / Derecho a la portabilidad)
app.get('/api/user/export', async (req, res) => {
    try {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ error: "No autorizado. Debes iniciar sesión para exportar tus datos." });
        }

        const user = req.user || {};
        const userId = user.id;

        // Buscar toda la información asociada al usuario en la base de datos
        const userData = await UserModel.findOne({ userId }).lean();
        const adminData = await AdminModel.findOne({ discordId: userId }).lean();
        const notificationsCreated = await NotificationModel.find({ createdBy: userId }).lean();
        const notificationsDeleted = await DeletedNotificationModel.find({ deletedBy: userId }).lean();

        // Datos básicos del perfil de Discord
        const discordProfile = {
            id: user.id,
            username: user.username,
            discriminator: user.discriminator || null,
            global_name: user.global_name || null,
            avatar: user.avatar || null,
            locale: user.locale || null
        };

        // Estructurar toda la información del usuario en un objeto JSON
        const exportData = {
            exportedAt: new Date().toISOString(),
            user: discordProfile,
            botData: userData || null,
            adminPermissions: adminData || null,
            notificationsCreated: notificationsCreated || [],
            notificationsDeleted: notificationsDeleted || [],
            servers: (user.guilds || []).map(g => ({
                id: g.id,
                name: g.name,
                icon: g.icon || null,
                owner: g.owner || false
            }))
        };

        // Enviar el archivo JSON como descarga automática
        const fileName = `prem-user-data-${userId}.json`;
        const jsonContent = JSON.stringify(exportData, null, 2);

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(jsonContent);
    } catch (error) {
        console.error("Error al exportar datos del usuario:", error);
        res.status(500).json({ error: "Error al exportar los datos del usuario" });
    }
});

function formatMoney(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return '0';

    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';

    if (abs >= 1_000_000_000) {
        return sign + (abs / 1_000_000_000).toFixed(1) + 'B';
    }
    if (abs >= 1_000_000) {
        return sign + (abs / 1_000_000).toFixed(1) + 'M';
    }
    if (abs >= 1_000) {
        const k = abs / 1_000;
        return sign + (Number.isInteger(k) ? String(k) : k.toFixed(1)) + 'k';
    }
    return sign + String(abs);
}

// Función auxiliar para adjuntar la foto de perfil de Discord a los usuarios del ranking
async function enrichUsersWithAvatars(users) {
    return await Promise.all(users.map(async (u) => {
        let avatarUrl = null;
        try {
            const discordUser = await client.users.fetch(u.userId).catch(() => null);
            if (discordUser) {
                avatarUrl = discordUser.displayAvatarURL({ dynamic: true, size: 128 });
            }
        } catch (e) {
            // Si falla la búsqueda, queda sin avatar
        }
        return {
            ...u,
            avatar: avatarUrl
        };
    }));
}

// Ruta Principal (Index)
app.get('/', async (req, res) => {
    try {
        const totalServers = client.guilds.cache.size;
        const totalUsers = client.guilds.cache.reduce((acc, guild) => acc + (guild.memberCount || 0), 0);
        
        let statsDoc = await StatsModel.findOne({ key: 'global_stats' });
        const totalCommands = statsDoc ? statsDoc.totalCommands : 0;

        // Obtenemos los tops de MongoDB filtrando solo a los que tienen actividad real
        const rawTopActivity = await UserModel.find({ level: { $gt: 1 } }).sort({ level: -1 }).limit(5).lean();
        const rawTopEconomy = await UserModel.find({ money: { $gt: 0 } }).sort({ money: -1 }).limit(5).lean();
        const rawTopMusic = await UserModel.find({ songs: { $gt: 0 } }).sort({ songs: -1 }).limit(5).lean();

        // Les inyectamos la foto de perfil de Discord en tiempo real
        const topActivity = await enrichUsersWithAvatars(rawTopActivity);
        const topEconomy = await enrichUsersWithAvatars(rawTopEconomy);
        const topMusic = await enrichUsersWithAvatars(rawTopMusic);

        const currentLang = resolveLang(req, res);

        res.render('index', { 
            user: req.user || null, 
            currentLang,
            lang: currentLang,
            t: loadTranslations(currentLang),
            stats: {
                servers: totalServers,
                users: totalUsers,
                commands: totalCommands
            },
            topEconomy: topEconomy, 
            topActivity: topActivity, 
            topMusic: topMusic, 
            listaReviews: [],
            formatMoney
        });
    } catch (error) {
        console.error("Error en la ruta principal:", error);
        const currentLang = resolveLang(req, res);
        res.render('index', { 
            user: req.user || null, 
            currentLang,
            lang: currentLang,
            t: loadTranslations(currentLang),
            stats: { servers: client.guilds.cache.size, users: 0, commands: 0 },
            topEconomy: [], topActivity: [], topMusic: [], listaReviews: [],
            formatMoney
        });
    }
});

// Ruta del Dashboard principal
app.get('/dashboard', async (req, res) => {
    try {
        if (!req.isAuthenticated()) return res.redirect('/auth/discord');
        
        const user = req.user || {};
        let guilds = user.guilds || [];

        if (guilds.length === 0 && user.accessToken) {
            try {
                const response = await axios.get('https://discord.com/api/users/@me/guilds', {
                    headers: { Authorization: `Bearer ${user.accessToken}` }
                });
                guilds = response.data;
            } catch (apiError) {
                console.error("API ERROR REAL:", apiError.response?.data || apiError.message || apiError);
            }
        }

        // Enriquecer guilds con la información de si el bot está instalado
        const enrichedGuilds = guilds.map(guild => ({
            ...guild,
            botInGuild: client.guilds && client.guilds.cache ? client.guilds.cache.has(guild.id) : false
        }));
        
        const currentLang = resolveLang(req, res);
        res.render('dashboard-select', { 
            user: user, 
            guilds: enrichedGuilds, 
            lang: currentLang,
            currentLang,
            t: loadTranslations(currentLang)
        });
    } catch (error) {
        console.error("ERROR FATAL EN /dashboard:", error.message);
        res.status(500).send(`Error en el servidor: ${error.message}`);
    }
});

// Ruta de Perfil de Usuario (BLOQUE 6.1)
app.get('/dashboard/perfil', async (req, res) => {
    try {
        if (!req.isAuthenticated()) return res.redirect('/auth/discord');
        
        const user = req.user || {};
        const currentLang = resolveLang(req, res);
        
        // Obtener datos del usuario desde MongoDB
        let userData = null;
        try {
            userData = await UserModel.findOne({ userId: user.id }).lean();
            if (userData) {
                // Verificar insignias en tiempo real al cargar el perfil
                userData.badges = await checkAndGrantBadges(user, userData);
            }
        } catch (e) {
            console.error("Error al obtener datos del usuario:", e);
        }
        
        res.render('dashboard-perfil', {
            user: user,
            userData: userData,
            currentLang,
            t: loadTranslations(currentLang)
        });
    } catch (error) {
        console.error("ERROR EN /dashboard/perfil:", error.message);
        res.status(500).send(`Error al cargar el perfil: ${error.message}`);
    }
});

app.get('/insignias', (req, res) => {
    const currentLang = resolveLang(req, res);
    res.render('insignias', { 
        user: req.user,
        currentLang,
        t: loadTranslations(currentLang)
    });
});


// Ruta de Personalización de Bot (BLOQUE 6.2)
app.get('/dashboard/bot/personalizacion', async (req, res) => {
    try {
        if (!req.isAuthenticated()) return res.redirect('/auth/discord');
        
        const user = req.user || {};
        const currentLang = resolveLang(req, res);
        
        res.render('dashboard-bot-personalizacion', {
            user: user,
            currentLang,
            t: loadTranslations(currentLang)
        });
    } catch (error) {
        console.error("ERROR EN /dashboard/bot/personalizacion:", error.message);
        res.status(500).send(`Error al cargar la personalización: ${error.message}`);
    }
});

// Ruta de Comandos Personalizados Premium (BLOQUE 6.3)
app.get('/dashboard/bot/comandos-premium', async (req, res) => {
    try {
        if (!req.isAuthenticated()) return res.redirect('/auth/discord');
        
        const user = req.user || {};
        const currentLang = resolveLang(req, res);
        
        res.render('dashboard-bot-comandos-premium', {
            user: user,
            currentLang,
            t: loadTranslations(currentLang)
        });
    } catch (error) {
        console.error("ERROR EN /dashboard/bot/comandos-premium:", error.message);
        res.status(500).send(`Error al cargar los comandos premium: ${error.message}`);
    }
});

// Ruta de Comandos
app.get('/comandos', (req, res) => {
    const currentLang = resolveLang(req, res);
    res.render('comandos', {
        user: req.user || null,
        currentLang,
        t: loadTranslations(currentLang)
    });
});

// Ruta de Variables
app.get('/variables', (req, res) => {
    const currentLang = resolveLang(req, res);
    res.render('variables', {
        user: req.user || null,
        currentLang,
        t: loadTranslations(currentLang)
    });
});

// Ruta de Documentación
app.get('/documentacion', (req, res) => {
    const currentLang = resolveLang(req, res);
    res.render('documentacion', {
        user: req.user || null,
        currentLang,
        t: loadTranslations(currentLang)
    });
});

// Ruta de FAQ
app.get('/faq', (req, res) => {
    const currentLang = resolveLang(req, res);
    res.render('faq', {
        user: req.user || null,
        currentLang,
        t: loadTranslations(currentLang)
    });
});

// Ruta de Contacto
app.get('/contacto', (req, res) => {
    const currentLang = resolveLang(req, res);
    res.render('contacto', {
        user: req.user || null,
        currentLang,
        t: loadTranslations(currentLang)
    });
});

// Ruta de Quejas
app.get('/quejas', (req, res) => {
    const currentLang = resolveLang(req, res);
    res.render('quejas', {
        user: req.user || null,
        currentLang,
        t: loadTranslations(currentLang)
    });
});

// Ruta de Sugerencias
app.get('/sugerencias', (req, res) => {
    const currentLang = resolveLang(req, res);
    res.render('sugerencias', {
        user: req.user || null,
        currentLang,
        t: loadTranslations(currentLang)
    });
});

// Ruta de Términos
app.get('/terminos', (req, res) => {
    const currentLang = resolveLang(req, res);
    res.render('terminos', {
        user: req.user || null,
        currentLang,
        t: loadTranslations(currentLang)
    });
});

// Ruta de Privacidad
app.get('/privacidad', (req, res) => {
    const currentLang = resolveLang(req, res);
    res.render('privacidad', {
        user: req.user || null,
        currentLang,
        t: loadTranslations(currentLang)
    });
});

// Ruta de Sala de Manager (protegida - Solo para el ID autorizado)
app.get('/manager-room', async (req, res) => {
    try {
        if (!req.isAuthenticated()) return res.redirect('/auth/discord');
        
        const user = req.user || {};
        
        // Validación estricta: Solo el ID autorizado puede acceder al Manager
        const MANAGER_ID = process.env.MANAGER_ID;
        if (user.id !== MANAGER_ID) {
            return res.status(403).send("Acceso denegado. No tienes permisos de Manager.");
        }
        
        const currentLang = resolveLang(req, res);
        res.render('manager-room', {
            user: user,
            currentLang,
            t: loadTranslations(currentLang)
        });
    } catch (error) {
        console.error("ERROR EN /manager-room:", error.message);
        res.status(500).send(`Error al cargar la sala de manager: ${error.message}`);
    }
});

// Ruta de gestión por Servidor
app.get('/dashboard/:guildId', async (req, res) => {
    try {
        if (!req.isAuthenticated()) return res.redirect('/auth/discord');
        
        const { guildId } = req.params;
        const user = req.user || {};
        let guilds = user.guilds || [];

        if (guilds.length === 0 && user.accessToken) {
            try {
                const response = await axios.get('https://discord.com/api/users/@me/guilds', {
                    headers: { Authorization: `Bearer ${user.accessToken}` }
                });
                guilds = response.data;
            } catch (apiError) {
                console.error("API ERROR REAL:", apiError.response?.data || apiError.message || apiError);
            }
        }

        const currentGuild = guilds.find(g => g.id === guildId);
        if (!currentGuild) {
            return res.status(403).send("No tienes acceso a este servidor o no fue encontrado.");
        }

        const currentLang = resolveLang(req, res);
        res.render('dashboard-server', { 
            user: user, 
            guild: currentGuild, 
            guildId: guildId,
            currentLang,
            t: loadTranslations(currentLang)
        });
        
    } catch (error) {
        console.error("ERROR EN /dashboard/:guildId:", error.message);
        res.status(500).send(`Error al cargar el servidor: ${error.message}`);
    }
});

// Eventos del Bot de Discord
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await StatsModel.findOneAndUpdate(
            { key: 'global_stats' },
            { $inc: { totalCommands: 1 } },
            { upsert: true, new: true }
        );

        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'Hubo un error al ejecutar este comando.', ephemeral: true });
        } else {
            await interaction.reply({ content: 'Hubo un error al ejecutar este comando.', ephemeral: true });
        }
    }
});

// INICIO DEL SERVIDOR WEB Y BOT DE DISCORD
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
    console.log(`Servidor web escuchando en el puerto ${PORT}`);
    
    const TOKEN = process.env.DISCORD_TOKEN;
    if (TOKEN) {
        client.login(TOKEN)
            .then(() => console.log('Bot de Discord conectado correctamente'))
            .catch(err => console.error('Error al iniciar sesión en Discord:', err));
    } else {
        console.warn("ADVERTENCIA: No se encontró DISCORD_TOKEN en las variables.");
    }
});