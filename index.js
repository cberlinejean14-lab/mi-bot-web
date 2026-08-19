require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

const app = express();

// 1. Inicializar el cliente de Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

// Configuración de Sesiones y Passport
app.use(session({
    secret: process.env.SESSION_SECRET || 'secreto_super_seguro_para_sesiones',
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(obj, done));

passport.use(new DiscordStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL || 'https://prem-production-5c47.up.railway.app/auth/discord/callback',
    scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
}));

// Configurar el motor de vistas y la carpeta pública
app.set('view engine', 'ejs');
app.set('views', path.resolve('./views'));
app.use(express.static(path.join(__dirname, 'public')));

// Función auxiliar para sumar comandos
function sumarComando() {
    try {
        let stats = { totalCommands: 0 };
        if (fs.existsSync('./stats.json')) {
            stats = JSON.parse(fs.readFileSync('./stats.json', 'utf8'));
        }
        stats.totalCommands = (stats.totalCommands || 0) + 1;
        fs.writeFileSync('./stats.json', JSON.stringify(stats, null, 2));
    } catch (error) {
        console.error('Error al actualizar el contador de comandos:', error);
    }
}

// Rutas
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', {
    failureRedirect: '/'
}), (req, res) => {
    res.redirect('/dashboard');
});

app.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        res.redirect('/');
    });
});

app.get('/api/stats', async (req, res) => {
    try {
        const serverCount = client.guilds.cache.size;
        const totalUsers = client.guilds.cache.reduce((acc, guild) => acc + (guild.memberCount || 0), 0);
        let totalCommands = 0;
        try {
            if (fs.existsSync('./stats.json')) {
                const statsData = JSON.parse(fs.readFileSync('./stats.json', 'utf8'));
                totalCommands = statsData.totalCommands || 0;
            }
        } catch (e) { totalCommands = 0; }
        res.json({
            servers: serverCount.toLocaleString(),
            users: totalUsers.toLocaleString(),
            commands: totalCommands.toLocaleString()
        });
    } catch (error) {
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.get('/', (req, res) => {
    res.render('index', { 
        user: req.user || null,
        currentLang: req.query.lang || 'es',
        rankingDinero: [],
        rankingXP: [],
        rankingMusica: [],
        listaReviews: []
    });
});

app.get('/dashboard', (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/auth/discord');
    const guilds = req.user.guilds || [];
    res.render('dashboard-select', { 
        user: req.user,
        guilds: guilds,
        lang: req.query.lang || 'es'
    });
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    sumarComando();
});

// 5. Iniciar bot y servidor en el puerto dinámico de Railway
const TOKEN = process.env.DISCORD_TOKEN;
const PORT = process.env.PORT || 3000;

client.login(TOKEN).then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Servidor web escuchando en el puerto ${PORT}`);
    });
}).catch(err => {
    console.error('Error al iniciar sesión:', err);
});