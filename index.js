require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const mongoose = require('mongoose');

const app = express();

// --- CONEXIÓN A MONGODB ---
mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI)
    .then(() => console.log('Conectado a MongoDB exitosamente'))
    .catch(err => console.error('Error al conectar a MongoDB:', err));

// --- MODELO DE USUARIO ---
const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    money: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    songs: { type: Number, default: 0 }
});
const UserModel = mongoose.model('User', userSchema);

// 1. Inicializar el cliente de Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

// --- CARGA DINÁMICA DE COMANDOS ---
client.commands = new Collection();
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.data.name, command);
}

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

app.set('view engine', 'ejs');
app.set('views', path.resolve('./views'));
app.use(express.static(path.join(__dirname, 'public')));

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

// Rutas (Auth, API, Web...)
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/dashboard'));
app.get('/logout', (req, res, next) => { req.logout((err) => { if (err) return next(err); res.redirect('/'); }); });

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
        res.json({ servers: serverCount.toLocaleString(), users: totalUsers.toLocaleString(), commands: totalCommands.toLocaleString() });
    } catch (error) { res.status(500).json({ error: 'Error interno del servidor' }); }
});

app.get('/', async (req, res) => {
    try {
        const topEconomy = await UserModel.find().sort({ money: -1 }).limit(3).lean();
        const topActivity = await UserModel.find().sort({ level: -1 }).limit(3).lean();
        const topMusic = await UserModel.find().sort({ songs: -1 }).limit(3).lean();
        
        // Variables corregidas para que coincidan con ranking.ejs
        res.render('index', { 
            user: req.user || null, 
            currentLang: req.query.lang || 'es', 
            topEconomy: topEconomy, 
            topActivity: topActivity, 
            topMusic: topMusic, 
            listaReviews: [] 
        });
    } catch (error) {
        res.render('index', { 
            user: req.user || null, 
            currentLang: req.query.lang || 'es', 
            topEconomy: [], 
            topActivity: [], 
            topMusic: [], 
            listaReviews: [] 
        });
    }
});

app.get('/dashboard', (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/auth/discord');
    res.render('dashboard-select', { user: req.user, guilds: req.user.guilds || [], lang: req.query.lang || 'es' });
});

// --- MANEJADOR DE COMANDOS ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
        sumarComando();
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'Hubo un error al ejecutar este comando.', ephemeral: true });
        } else {
            await interaction.reply({ content: 'Hubo un error al ejecutar este comando.', ephemeral: true });
        }
    }
});

const TOKEN = process.env.DISCORD_TOKEN;
const PORT = process.env.PORT || 3000;

client.login(TOKEN).then(() => {
    app.listen(PORT, '0.0.0.0', () => console.log(`Servidor web escuchando en el puerto ${PORT}`));
}).catch(err => console.error('Error al iniciar sesión:', err));