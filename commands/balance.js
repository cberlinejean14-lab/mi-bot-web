const { SlashCommandBuilder } = require('discord.js');
const mongoose = require('mongoose');
const UserModel = mongoose.model('User');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Revisa tu dinero actual en el banco'),
    
    async execute(interaction) {
        const userId = interaction.user.id;
        const userName = interaction.user.username;

        try {
            let dbUser = await UserModel.findOne({ userId });

            if (!dbUser) {
                dbUser = new UserModel({ userId, name: userName, money: 0 });
                await dbUser.save();
            }

            await interaction.reply(`🪙 **${userName}**, tienes un total de **${dbUser.money}** monedas.`);
        } catch (error) {
            console.error('Error al ver el balance:', error);
            await interaction.reply({ content: 'Hubo un error al consultar tu balance.', ephemeral: true });
        }
    },
};