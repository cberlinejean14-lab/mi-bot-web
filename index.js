require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

// 1. Inicializar el cliente de Discord con sus Intents necesarios para métricas reales
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

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
    const guilds = [
        { id: '1', name: 'Servidor de Ejemplo 1', icon: null, owner: true, permissions: 8 },
        { id: '2', name: 'Servidor de Ejemplo 2', icon: null, owner: false, permissions: 8 }
    ];
    
    res.render('dashboard-select', { 
        user: req.user || { username: 'Ganzita', id: '123456789', avatar: 'default' },
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
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Bot conectado y servidor web corriendo en el puerto ${PORT}`);
    });
}).catch(err => {
    console.error('Error al iniciar sesión con el bot de Discord:', err);
});