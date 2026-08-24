require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const fs = require('fs');
const path = require('path');

const app = express();

// Configurar motor de vistas EJS
app.set('view engine', 'ejs');

// Configuración de Middlewares
app.use(cookieParser());

// Configuración de Sesión
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));

// Inicializar Passport
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(obj, done));

// Configurar la estrategia de Discord
passport.use(new DiscordStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
    profile.accessToken = accessToken;
    return done(null, profile);
}));

// Función inteligente de traducción automática
function translatePage(lang) {
    const defaultLang = 'es';
    const supportedLangs = ['es', 'en', 'pt', 'fr', 'hi', 'ar', 'zh'];
    const selectedLang = supportedLangs.includes(lang) ? lang : defaultLang;
    
    try {
        const filePath = path.join(__dirname, 'locales', `${selectedLang}.json`);
        const fileData = fs.readFileSync(filePath, 'utf8');
        const translations = JSON.parse(fileData);
        
        // Retorna una función "t" que traduce el texto si existe en el JSON, o lo deja igual si no lo encuentra
        return (text) => {
            return translations[text] || text;
        };
    } catch (error) {
        return (text) => text; // Si falla, devuelve el texto original
    }
}

// --- RUTAS ---

// 1. Página de inicio conectada a EJS y los archivos JSON de idiomas
app.get('/', (req, res) => {
    // Detectar idioma desde ?lang= en la URL o de la cookie guardada
    const lang = req.query.lang || req.cookies.lang || 'es';

    // Guardar la cookie por 30 días
    res.cookie('lang', lang, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true });

    // Obtener la función de traducción 't'
    const t = translatePage(lang);

    // Renderizar la vista 'index.ejs' enviándole el usuario, el idioma actual y la función de traducción (t)
    res.render('index', { 
        user: req.user || null, 
        currentLang: lang, 
        t: t 
    });
});

// 2. Ruta para iniciar el auth
app.get('/auth/discord', passport.authenticate('discord'));

// 3. Callback de Discord
app.get('/auth/discord/callback', 
    passport.authenticate('discord', { failureRedirect: '/' }),
    (req, res) => {
        res.redirect('/dashboard');
    }
);

// 4. Dashboard protegido
app.get('/dashboard', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/');
    }
    res.send(`
        <h1>Panel Protegido</h1>
        <p>ID de usuario: ${req.user.id}</p>
        <p>Token de acceso obtenido con éxito.</p>
        <a href="/">Volver al inicio</a> | 
        <a href="/logout">Cerrar sesión</a>
    `);
});

// 5. Logout
app.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        res.redirect('/');
    });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});