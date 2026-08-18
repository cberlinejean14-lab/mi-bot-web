require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

const app = express();

// 1. Inicializar el cliente de Discord con sus Intents necesarios para métricas reales
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

// Configuración de Sesiones y Passport para el Login
app.use(session({
    secret: process.env.SESSION_SECRET || 'secreto_super_seguro_para_sesiones',
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: process.env.CLIENT_ID,
clientSecret: process.env.CLIENT_SECRET,
callbackURL: process.env.CALLBACK_URL || 'https://prem-production-5c47.up.railway.app/auth/discord/callback',
    scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
}));

// Configurar el motor de vistas EJS y la carpeta pública
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// Función auxiliar para sumar comandos al archivo stats.json de manera segura
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

// Rutas de Autenticación con Discord
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

// 2. Ruta API para alimentar las estadísticas en tiempo real
app.get('/api/stats', async (req, res) => {
    try {
        const serverCount = client.guilds.cache.size;
        
        // Suma los miembros de todos los servidores en caché de forma segura
        const totalUsers = client.guilds.cache.reduce((acc, guild) => acc + (guild.memberCount || 0), 0);
        
        // Leemos el archivo stats.json para obtener los comandos reales
        let totalCommands = 0;
        try {
            if (fs.existsSync('./stats.json')) {
                const statsData = JSON.parse(fs.readFileSync('./stats.json', 'utf8'));
                totalCommands = statsData.totalCommands || 0;
            }
        } catch (e) {
            totalCommands = 0;
        }

        res.json({
            servers: serverCount.toLocaleString(),
            users: totalUsers.toLocaleString(),
            commands: totalCommands.toLocaleString()
        });
    } catch (error) {
        console.error('Error al obtener estadísticas en tiempo real:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 3. Ruta Principal (Página de inicio)
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

// 4. Ruta del Dashboard
app.get('/dashboard', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/auth/discord');
    }

    const guilds = req.user.guilds || [
        { id: '1', name: 'Servidor de Ejemplo 1', icon: null, owner: true, permissions: 8 },
        { id: '2', name: 'Servidor de Ejemplo 2', icon: null, owner: false, permissions: 8 }
    ];
    
    res.render('dashboard-select', { 
        user: req.user,
        guilds: guilds,
        lang: req.query.lang || 'es'
    });
});

// Detector automático de comandos ejecutados en Discord
client.on('interactionCreate', async interaction => {
    // Verificamos si la interacción es un comando de barra (ChatInputCommand)
    if (!interaction.isChatInputCommand()) return;

    // Sumamos +1 al archivo stats.json cada vez que alguien usa un comando
    sumarComando();
});

// 5. Iniciar sesión del bot de Discord y levantar el servidor web
const TOKEN = process.env.DISCORD_TOKEN;
const PORT = process.env.PORT || 3000;

client.login(TOKEN).then(() => {
    // Configurado con '0.0.0.0' para que Railway exponga la web correctamente
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Servidor corriendo en el puerto ${PORT}`);
    });
}).catch(err => {
    console.error('Error al iniciar sesión:', err);
}); 