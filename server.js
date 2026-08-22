require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

const app = express();

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
    // Guardamos el token en el perfil para usarlo si es necesario
    profile.accessToken = accessToken;
    return done(null, profile);
}));

// --- RUTAS ---

// 1. Página de inicio simple con un botón para loguearse
app.get('/', (req, res) => {
    if (req.isAuthenticated()) {
        return res.send(`
            <h1>¡Hola, ${req.user.username}!</h1>
            <p>Has iniciado sesión correctamente con Discord.</p>
            <a href="/dashboard">Ir al Dashboard de prueba</a> | 
            <a href="/logout">Cerrar sesión</a>
        `);
    }
    res.send(`
        <h1>Prueba de Login con Discord</h1>
        <a href="/auth/discord" style="padding: 10px 20px; background: #5865F2; color: white; text-decoration: none; border-radius: 5px;">Iniciar sesión con Discord</a>
    `);
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
    console.log(`Servidor de prueba corriendo en http://localhost:${PORT}`);
});