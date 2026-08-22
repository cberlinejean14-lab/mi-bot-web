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

const app = express();

app.set('trust proxy', 1);

// Conexión a MongoDB (protegida para que no tumbe la web si falla)
mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI)
    .then(() => console.log('Conectado a MongoDB exitosamente'))
    .catch(err => console.error('Error al conectar a MongoDB:', err));

const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    money: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    songs: { type: Number, default: 0 }
});
const UserModel = mongoose.model('User', userSchema);

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
        maxAge: 24 * 60 * 60 * 1000
    }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(obj, done));

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

// Ruta Principal (Index)
app.get('/', async (req, res) => {
    try {
        res.render('index', { 
            user: req.user || null, 
            currentLang: req.query.lang || 'es', 
            topEconomy: [], 
            topActivity: [], 
            topMusic: [], 
            listaReviews: [] 
        });
    } catch (error) {
        res.send("Bienvenido a la página principal del bot.");
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
                console.error("API ERROR MESSAGE:", apiError.message);
            }
        }
        
        res.render('dashboard-select', { 
            user: user, 
            guilds: guilds, 
            lang: req.query.lang || 'es' 
        });
    } catch (error) {
        console.error("ERROR FATAL EN /dashboard:", error.message);
        res.status(500).send(`Error en el servidor: ${error.message}`);
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
                console.error("API ERROR:", apiError.message);
            }
        }

        const currentGuild = guilds.find(g => g.id === guildId);
        if (!currentGuild) {
            return res.status(403).send("No tienes acceso a este servidor o no fue encontrado.");
        }

        res.send(`Panel de administración para el servidor: <strong>${currentGuild.name}</strong>`);
        
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

// INICIO DEL SERVIDOR WEB (Independiente para evitar caídas 502)
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor web escuchando en el puerto ${PORT}`);
});

// INICIO DEL BOT DE DISCORD
const TOKEN = process.env.DISCORD_TOKEN;
if (TOKEN) {
    client.login(TOKEN)
        .then(() => console.log('Bot de Discord conectado correctamente'))
        .catch(err => console.error('Error al iniciar sesión en Discord:', err));
} else {
    console.warn("ADVERTENCIA: No se encontró DISCORD_TOKEN en las variables.");
}