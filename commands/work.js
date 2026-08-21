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
        .setName('work')
        .setDescription('Trabaja duro para ganar algunas monedas'),
    
    async execute(interaction) {
        const userId = interaction.user.id;
        const userName = interaction.user.username;
        const ganancias = Math.floor(Math.random() * 500) + 100; // Entre 100 y 600 monedas

        try {
            const UserModel = getUserModel();
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
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'Hubo un error al ejecutar el comando.', ephemeral: true });
            } else {
                await interaction.reply({ content: 'Hubo un error al ejecutar el comando.', ephemeral: true });
            }
        }
    },
};