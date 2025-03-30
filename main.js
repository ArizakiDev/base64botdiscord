const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const mongoose = require('mongoose');
require('dotenv').config();

// Configuration
const TOKEN = process.env.DISCORD_TOKEN || 'DiscordToken';
const CLIENT_ID = process.env.CLIENT_ID || 'Bot_ID';
const MONGODB_URI = process.env.MONGODB_URI || 'mongoURI';

// Connexion à MongoDB
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Connecté à MongoDB');
}).catch(err => {
  console.error('Erreur de connexion à MongoDB:', err);
  process.exit(1);
});

// Schéma et modèle pour les codes base64
const codeSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  username: { type: String, required: true },
  name: { type: String, required: true },
  code: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Index composé pour s'assurer que la combinaison userId+name est unique
codeSchema.index({ userId: 1, name: 1 }, { unique: true });

const CodeModel = mongoose.model('Code', codeSchema);

// Création du client Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Fonction pour enregistrer un nouveau code base64
async function saveBase64Code(userId, username, name, code) {
  try {
    // Utilisation de findOneAndUpdate avec upsert pour créer ou mettre à jour
    await CodeModel.findOneAndUpdate(
      { userId, name },
      { userId, username, name, code },
      { upsert: true, new: true }
    );
    return true;
  } catch (error) {
    console.error('Erreur lors de l\'enregistrement du code:', error);
    return false;
  }
}

// Fonction pour obtenir un code spécifique
async function getBase64Code(userId, name) {
  try {
    const codeDoc = await CodeModel.findOne({ userId, name });
    return codeDoc ? codeDoc.code : null;
  } catch (error) {
    console.error('Erreur lors de la récupération du code:', error);
    return null;
  }
}

// Fonction pour lister tous les codes d'un utilisateur
async function listUserCodes(userId) {
  try {
    const codes = await CodeModel.find({ userId });
    return codes.map(codeDoc => ({ name: codeDoc.name, createdAt: codeDoc.createdAt }));
  } catch (error) {
    console.error('Erreur lors de la récupération des codes de l\'utilisateur:', error);
    return [];
  }
}

// Fonction pour convertir base64 en texte
function decodeBase64(base64) {
  return Buffer.from(base64, 'base64').toString('utf8');
}

// Fonction pour convertir texte en base64
function encodeBase64(text) {
  return Buffer.from(text).toString('base64');
}

// Fonction pour vérifier si une chaîne est un base64 valide
function isValidBase64(str) {
  try {
    return Buffer.from(str, 'base64').toString('base64') === str;
  } catch (e) {
    return false;
  }
}

// Définition des commandes slash
const commands = [
  new SlashCommandBuilder()
    .setName('save')
    .setDescription('Enregistre un code base64')
    .addStringOption(option => 
      option.setName('nom')
        .setDescription('Nom du code à enregistrer')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('code')
        .setDescription('Code base64 à enregistrer')
        .setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('files')
    .setDescription('Liste les codes d\'un utilisateur')
    .addUserOption(option => 
      option.setName('utilisateur')
        .setDescription('Utilisateur dont vous voulez voir les codes')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('nom')
        .setDescription('Nom spécifique du code à récupérer')
        .setRequired(false)),
  
  new SlashCommandBuilder()
    .setName('encode')
    .setDescription('Convertit un texte en base64')
    .addStringOption(option => 
      option.setName('texte')
        .setDescription('Texte à convertir en base64')
        .setRequired(true)),
]
.map(command => command.toJSON());

// Enregistrement des commandes slash lors du démarrage
const rest = new REST({ version: '10' }).setToken(TOKEN);

client.once('ready', async () => {
  try {
    console.log('Début de l\'enregistrement des commandes slash...');
    
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands },
    );
    
    console.log('Commandes slash enregistrées avec succès!');
    console.log(`Bot connecté en tant que ${client.user.tag}!`);
  } catch (error) {
    console.error('Erreur lors de l\'enregistrement des commandes slash:', error);
  }
});

// Gestion des commandes slash
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName, options, user } = interaction;

  switch (commandName) {
    case 'save':
      {
        const name = options.getString('nom');
        const code = options.getString('code');
        
        // Vérifier que c'est bien du base64
        if (!isValidBase64(code)) {
          await interaction.reply({ content: '❌ Le code fourni n\'est pas un base64 valide.', ephemeral: true });
          return;
        }
        
        const success = await saveBase64Code(user.id, user.username, name, code);
        
        if (success) {
          await interaction.reply({ content: `✅ Code '${name}' enregistré avec succès!`, ephemeral: true });
        } else {
          await interaction.reply({ content: '❌ Erreur lors de l\'enregistrement du code.', ephemeral: true });
        }
      }
      break;
      
    case 'files':
      {
        const targetUser = options.getUser('utilisateur');
        const specificName = options.getString('nom');
        
        if (specificName) {
          // Demande d'un code spécifique
          const code = await getBase64Code(targetUser.id, specificName);
          
          if (!code) {
            await interaction.reply({ content: `❌ Aucun code nommé '${specificName}' trouvé pour ${targetUser.username}.`, ephemeral: true });
            return;
          }
          
          // Décodage du code
          try {
            const decodedContent = decodeBase64(code);
            // Envoi en MP
            await user.send(`📁 Code demandé: ${specificName}\n\`\`\`\n${decodedContent}\n\`\`\``);
            await interaction.reply({ content: `✅ Le code '${specificName}' de ${targetUser.username} vous a été envoyé en message privé.`, ephemeral: true });
          } catch (error) {
            console.error('Erreur lors du décodage ou de l\'envoi:', error);
            await interaction.reply({ content: '❌ Erreur lors du décodage ou de l\'envoi du message privé.', ephemeral: true });
          }
        } else {
          // Liste tous les codes
          const codesList = await listUserCodes(targetUser.id);
          
          if (codesList.length === 0) {
            await interaction.reply({ content: `${targetUser.username} n'a pas de codes enregistrés.`, ephemeral: false });
            return;
          }
          
          const formattedList = codesList.map(code => {
            const date = new Date(code.createdAt).toLocaleDateString();
            return `- \`${code.name}\` (créé le ${date})`;
          }).join('\n');
          
          await interaction.reply({
            content: `📋 Liste des codes de ${targetUser.username}:\n${formattedList}`,
            ephemeral: false
          });
        }
      }
      break;
      
    case 'encode':
      {
        const text = options.getString('texte');
        const encoded = encodeBase64(text);
        await interaction.reply({
          content: `🔒 Texte encodé en base64:\n\`\`\`\n${encoded}\n\`\`\``,
          ephemeral: false
        });
      }
      break;
  }
});

// Connexion du bot
client.login(TOKEN);