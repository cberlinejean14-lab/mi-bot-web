const { SlashCommandBuilder } = require('discord.js');
const mongoose = require('mongoose');
const UserModel = mongoose.model('User');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('work')
        .setDescription('Trabaja duro para ganar algunas monedas'),
    
    async execute(interaction) {
        const userId = interaction.user.id;
        const userName = interaction.user.username;
        const ganancias = Math.floor(Math.random() * 500) + 100; // Entre 100 y 600 monedas

        try {
            const dbUser = await UserModel.findOneAndUpdate(
                { userId: userId },
                { 
                    $set: { name: userName },
                    $inc: { money: ganancias } 
                },
                { upsert: true, new: true }
            );

            await interaction.reply(`¡Trabajaste duro y ganaste **${ganancias}** monedas! 🪙 Tu total ahora es de **${dbUser.money}** monedas.`);
        } catch (error) {
            console.error('Error en el comando work:', error);
            await interaction.reply({ content: 'Hubo un error al ejecutar el comando.', ephemeral: true });
        }
    },
};