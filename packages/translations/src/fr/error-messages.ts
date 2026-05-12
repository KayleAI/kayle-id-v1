import type { ERROR_MESSAGES } from "../en/error-messages";
import type { LocalizedDictionary } from "../i18n";

type ErrorMessages = LocalizedDictionary<typeof ERROR_MESSAGES>;

/** French translation of the shared error-messages dictionary. */
export const ERROR_MESSAGES_FR: ErrorMessages = {
  UNKNOWN: {
    title: "Une erreur est survenue",
    description: "Nous n’avons pas pu terminer cette vérification. Réessayez.",
  },

  INVALID_SESSION_ID: {
    title: "Lien invalide",
    description:
      "Ce lien n’est pas valide. Retournez en arrière et ouvrez-en un nouveau.",
  },

  SESSION_EXPIRED: {
    title: "Session expirée",
    description: "Cette session a expiré. Recommencez.",
  },

  SESSION_NOT_FOUND: {
    title: "Session introuvable",
    description: "Nous ne trouvons pas cette session. Recommencez.",
  },

  SESSION_IN_PROGRESS: {
    title: "Déjà en cours",
    description: "Continuez sur l’appareil où vous avez commencé.",
  },

  HELLO_AUTH_REQUIRED: {
    title: "Authentification requise",
    description: "Cette connexion n’a pas d’identifiants. Veuillez réessayer.",
  },

  ATTEMPT_NOT_FOUND: {
    title: "Session introuvable",
    description: "Cette session n’est plus disponible. Recommencez.",
  },

  HANDOFF_TOKEN_INVALID: {
    title: "Code QR invalide",
    description:
      "Ce code n’est pas valide. Scannez-en un nouveau depuis votre navigateur.",
  },

  HANDOFF_TOKEN_EXPIRED: {
    title: "Code QR expiré",
    description: "Ce code a expiré. Générez-en un nouveau.",
  },

  HANDOFF_TOKEN_CONSUMED: {
    title: "Code QR déjà utilisé",
    description: "Continuez sur votre appareil d’origine ou recommencez.",
  },

  HANDOFF_DEVICE_MISMATCH: {
    title: "Mauvais appareil",
    description:
      "Utilisez l’appareil avec lequel vous avez commencé, ou recommencez.",
  },

  HELLO_ATTEST_KEY_UNKNOWN: {
    title: "Appareil non enregistré",
    description:
      "Votre appareil n’a pas terminé la configuration. Rouvrez l’application pour l’enregistrer, puis réessayez.",
  },

  HELLO_ATTEST_INVALID: {
    title: "Échec de la vérification de l’appareil",
    description:
      "Nous n’avons pas pu confirmer votre appareil. Réinstallez l’application ou contactez le support.",
  },

  MIN_APP_VERSION_REQUIRED: {
    title: "Mise à jour requise",
    description:
      "Mettez à jour Kayle ID vers la dernière version pour continuer la vérification.",
  },

  CANCEL_TOKEN_INVALID: {
    title: "Impossible d’annuler la session",
    description:
      "Cette session ne peut pas être annulée depuis ce lien. Ouvrez le lien de vérification d’origine ou contactez le support.",
  },

  CANCEL_TOKEN_USED: {
    title: "Déjà annulée",
    description: "Cette session a déjà été annulée.",
  },

  INVALID_REQUEST: {
    title: "Requête invalide",
    description: "La requête est manquante ou mal formée.",
  },

  ATTEMPT_CONNECTION_ACTIVE: {
    title: "Déjà ouverte",
    description:
      "Cette session est active ailleurs. Continuez-y ou réessayez plus tard.",
  },

  PHASE_OUT_OF_ORDER: {
    title: "Hors séquence",
    description: "Continuez depuis l’étape actuelle.",
  },

  NFC_DATA_PHASE_REQUIRED: {
    title: "Pas encore prêt",
    description: "Scannez votre document lorsque cela vous est demandé.",
  },

  DATA_CHUNK_RETRY: {
    title: "Échec du téléversement",
    description: "Réessayez le téléversement.",
  },

  NFC_REQUIRED_DATA_MISSING: {
    title: "Scan du document incomplet",
    description: "Terminez le scan de votre document pour continuer.",
  },

  LIVENESS_DATA_PHASE_REQUIRED: {
    title: "Vérification de présence requise",
    description: "Suivez les instructions de mouvement de tête pour continuer.",
  },

  LIVENESS_REQUIRED_DATA_MISSING: {
    title: "Vérification de présence incomplète",
    description: "Enregistrez les mouvements de tête demandés pour continuer.",
  },

  SHARE_SELECTION_REQUIRED: {
    title: "Sélectionnez des informations",
    description: "Choisissez au moins une information pour continuer.",
  },

  SHARE_SELECTION_INVALID_FIELD: {
    title: "Sélection invalide",
    description:
      "Certaines informations sélectionnées ne sont pas disponibles. Vérifiez et réessayez.",
  },

  SHARE_SELECTION_MISSING_REQUIRED: {
    title: "Informations requises manquantes",
    description:
      "Vous devez conserver les informations requises sélectionnées.",
  },

  document_authenticity_failed: {
    title: "Échec de la vérification du document",
    description:
      "Nous n’avons pas pu vérifier votre document. Réessayez ou utilisez-en un autre.",
  },

  document_active_authentication_failed: {
    title: "Échec de la vérification du document",
    description:
      "Nous n’avons pas pu confirmer la puce de votre document. Réessayez ou utilisez-en un autre.",
  },

  document_chip_authentication_failed: {
    title: "Échec de la vérification du document",
    description:
      "Nous n’avons pas pu confirmer la puce de votre document. Réessayez ou utilisez-en un autre.",
  },

  document_anti_cloning_attestation_failed: {
    title: "Échec de la vérification du document",
    description:
      "Nous n’avons pas pu confirmer que ce scan provient d’un appareil de confiance. Réessayez sur le même appareil ou contactez le support.",
  },

  selfie_face_mismatch: {
    title: "Le visage ne correspond pas",
    description:
      "Votre visage ne correspond pas à la photo de votre document. Réessayez.",
  },

  liveness_failed: {
    title: "Échec de la vérification de présence",
    description:
      "Nous n’avons pas pu confirmer la présence d’une personne en direct. Réessayez en suivant les instructions de mouvement de tête.",
  },
};
