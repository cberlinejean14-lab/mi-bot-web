const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

// Define cómo guardar al usuario en la sesión
passport.serializeUser((user, done) => {
    done(null, user);
});

// Define cómo recuperar al usuario de la sesión
passport.deserializeUser((obj, done) => {
    done(null, obj);
});

// Configuración de la estrategia de Discord
passport.use(new DiscordStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
}));