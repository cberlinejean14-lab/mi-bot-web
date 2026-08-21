require('dotenv').config({ path: './.env' });
const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const mongoose = require('mongoose');

// Definir el modelo temporalmente en memoria para que los archivos balance.js y work.js no fallen al ser leídos
try {
    if (!mongoose.models.User) {
        const userSchema = new mongoose.Schema({
            userId: { type: String, required: true, unique: true },
            name: { type: String, required: true },
            money: { type: Number, default: 0 },
            level: { type: Number, default: 1 },
            songs: { type: Number, default: 0 }
        });
        mongoose.model('User', userSchema);
    }
} catch (e) {}

const commands = [];

// Leer dinámicamente los comandos de la carpeta commands
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    try {
        const command = require(`./commands/${file}`);
        if (command && command.data) {
            commands.push(command.data.toJSON());
        }
    } catch (error) {
        console.error(`No se pudo cargar el comando del archivo ${file}:`, error.message);
    }
}

// Agregar el comando ping explícitamente
commands.push(
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Responde con Pong y comprueba que el bot está activo.')
        .toJSON()
);

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Iniciando la actualización de los comandos de barra (/).');

        await rest.put(
            Routes.applicationCommands('1534632950224781548'),
            { body: commands },
        );

        console.log('¡Comandos de barra (/) recargados exitosamente!');
        process.exit(0);
    } catch (error) {
        console.error('Hubo un error al registrar los comandos:', error);
        process.exit(1);
    }
})();