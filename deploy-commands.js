require('dotenv').config({ path: './.env' });
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Responde con Pong y comprueba que el bot está activo.'),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Iniciando la actualización de los comandos de barra (/).');

        // REEMPLAZA 'TU_CLIENT_ID' por el ID real de tu aplicación de Discord
        await rest.put(
            Routes.applicationCommands('1534632950224781548'),
            { body: commands },
        );

        console.log('¡Comandos de barra (/) recargados exitosamente!');
    } catch (error) {
        console.error('Hubo un error al registrar los comandos:', error);
    }
})();