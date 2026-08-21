const { SlashCommandBuilder } = require('discord.js');
const mongoose = require('mongoose');

// Obtener o definir el modelo de forma segura
const getUserModel = () => {
    if (mongoose.models.User) {
        return mongoose.model('User');
    }
    const userSchema = new mongoose.Schema({
        userId: { type: String, required: true, unique: true },
        name: { type: String, required: true },
        money: { type: Number, default: 0 },
        level: { type: Number, default: 1 },
        songs: { type: Number, default: 0 }
    });
    return mongoose.model('User', userSchema);
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Revisa tu dinero actual en el banco'),
    
    async execute(interaction) {
        const userId = interaction.user.id;
        const userName = interaction.user.username;

        try {
            const UserModel = getUserModel();
            let dbUser = await UserModel.findOne({ userId });

            if (!dbUser) {
                dbUser = new UserModel({ userId, name: userName, money: 0 });
                await dbUser.save();
            }

            await interaction.reply(`🪙 **${userName}**, tienes un total de **${dbUser.money}** monedas.`);
        } catch (error) {
            console.error('Error al ver el balance:', error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'Hubo un error al consultar tu balance.', ephemeral: true });
            } else {
                await interaction.reply({ content: 'Hubo un error al consultar tu balance.', ephemeral: true });
            }
        }
    },
};