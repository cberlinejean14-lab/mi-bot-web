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

const statsSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    totalCommands: { type: Number, default: 0 }
});
const StatsModel = mongoose.model('Stats', statsSchema);

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

        res.render('index', { 
            user: req.user || null, 
            currentLang: req.query.lang || 'es', 
            stats: {
                servers: totalServers,
                users: totalUsers,
                commands: totalCommands
            },
            topEconomy: topEconomy, 
            topActivity: topActivity, 
            topMusic: topMusic, 
            listaReviews: [] 
        });
    } catch (error) {
        console.error("Error en la ruta principal:", error);
        res.render('index', { 
            user: req.user || null, 
            currentLang: req.query.lang || 'es', 
            stats: { servers: client.guilds.cache.size, users: 0, commands: 0 },
            topEconomy: [], topActivity: [], topMusic: [], listaReviews: [] 
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
                console.error("API ERROR REAL:", apiError.response?.data || apiError.message || apiError);
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