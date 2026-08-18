const passport = require('passport');

function iniciarDashboard(app, client) {

    // Middleware para verificar si el usuario ha iniciado sesión
    function checkAuth(req, res, next) {
        if (req.isAuthenticated()) return next();
        res.redirect('/auth/discord');
    }

    // Ruta para iniciar sesión con Discord
    app.get('/auth/discord', passport.authenticate('discord'));

    // Ruta de redirección (Callback) de Discord
    app.get('/auth/discord/callback', 
        passport.authenticate('discord', { failureRedirect: '/' }), 
        (req, res) => {
            res.redirect('/dashboard');
        }
    );

    // Ruta para cerrar sesión
    app.get('/logout', (req, res, next) => {
        req.logout(function(err) {
            if (err) { return next(err); }
            res.redirect('/');
        });
    });

    // Ruta principal del Dashboard (Protegida)
    app.get('/dashboard', checkAuth, async (req, res) => {
        try {
            const userGuilds = (req.user && req.user.guilds) ? req.user.guilds : [];
            const guildsList = Array.isArray(userGuilds) ? userGuilds.map(guild => ({
                id: guild.id || '',
                name: guild.name || 'Servidor sin nombre',
                icon: guild.icon || null,
                owner: Boolean(guild.owner),
                permissions: guild.permissions || 0,
                administrator: Boolean(guild.administrator),
                botInGuild: client.guilds && client.guilds.cache ? client.guilds.cache.has(guild.id) : false
            })) : [];

            return res.render('dashboard-select', { 
                guilds: guildsList, 
                user: req.user || { username: 'Invitado', id: '0' }
            }); 
        } catch (error) {
            const errorMsg = typeof error === 'object' ? (error.stack || JSON.stringify(error, null, 2)) : String(error);
            console.error("🔥 ERROR REAL EN /DASHBOARD:", errorMsg);
            return res.status(500).send(`
                <h3 style="color: #ff5252;">Error exacto en el servidor:</h3>
                <pre style="background: #1e1e1e; color: #ff6b6b; padding: 15px; border-radius: 5px; white-space: pre-wrap;">${errorMsg}</pre>
            `);
        }
    });

    // Ruta de inicio (Landing page)
    app.get('/', (req, res) => {
        res.render('index', { user: req.user || null });
    });
}

module.exports = { iniciarDashboard };