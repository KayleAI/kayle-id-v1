import { DEFAULT_LOCALE, type Locale, type LocalizedDictionary } from "./i18n";

/**
 * English source of truth. New languages are added by registering a
 * dictionary with the same shape in `ERROR_MESSAGES_BY_LOCALE` below.
 */
export const ERROR_MESSAGES = {
  UNKNOWN: {
    title: "Something went wrong",
    description: "We couldn’t complete this check. Try again.",
  },

  INVALID_SESSION_ID: {
    title: "Invalid link",
    description: "This link isn’t valid. Go back and open a new one.",
  },

  SESSION_EXPIRED: {
    title: "Session expired",
    description: "This session has expired. Start again.",
  },

  SESSION_NOT_FOUND: {
    title: "Session not found",
    description: "We can’t find this session. Start again.",
  },

  SESSION_IN_PROGRESS: {
    title: "Already in progress",
    description: "Continue on the device where you started.",
  },

  HELLO_AUTH_REQUIRED: {
    title: "Authentication required",
    description: "This connection is missing credentials. Please try again.",
  },

  ATTEMPT_NOT_FOUND: {
    title: "Session not found",
    description: "This session is no longer available. Start again.",
  },

  HANDOFF_TOKEN_INVALID: {
    title: "Invalid QR code",
    description: "This code isn’t valid. Scan a new one from your browser.",
  },

  HANDOFF_TOKEN_EXPIRED: {
    title: "QR code expired",
    description: "This code has expired. Generate a new one.",
  },

  HANDOFF_TOKEN_CONSUMED: {
    title: "QR code already used",
    description: "Continue on your original device or start again.",
  },

  HANDOFF_DEVICE_MISMATCH: {
    title: "Wrong device",
    description: "Use the device you started with or start again.",
  },

  HELLO_ATTEST_KEY_UNKNOWN: {
    title: "Device not registered",
    description:
      "Your device hasn’t completed setup. Reopen the app to register and try again.",
  },

  HELLO_ATTEST_INVALID: {
    title: "Device check failed",
    description:
      "We couldn’t confirm your device. Reinstall the app or contact support.",
  },

  MIN_APP_VERSION_REQUIRED: {
    title: "Update required",
    description: "Update Kayle ID to the latest version to continue verifying.",
  },

  CANCEL_TOKEN_INVALID: {
    title: "Cannot cancel session",
    description:
      "This session can’t be cancelled from this link. Open the original verify link or contact support.",
  },

  CANCEL_TOKEN_USED: {
    title: "Already cancelled",
    description: "This session has already been cancelled.",
  },

  INVALID_REQUEST: {
    title: "Invalid request",
    description: "The request payload was missing or malformed.",
  },

  ATTEMPT_CONNECTION_ACTIVE: {
    title: "Already open",
    description:
      "This session is active elsewhere. Continue there or try again later.",
  },

  PHASE_OUT_OF_ORDER: {
    title: "Out of order",
    description: "Continue from the current step.",
  },

  NFC_DATA_PHASE_REQUIRED: {
    title: "Not ready yet",
    description: "Scan your document when prompted.",
  },

  DATA_CHUNK_RETRY: {
    title: "Upload failed",
    description: "Retry the upload.",
  },

  NFC_REQUIRED_DATA_MISSING: {
    title: "Document scan incomplete",
    description: "Finish scanning your document to continue.",
  },

  SELFIE_DATA_PHASE_REQUIRED: {
    title: "Selfie needed",
    description: "Take a selfie to continue.",
  },

  SELFIE_REQUIRED_DATA_MISSING: {
    title: "Selfie missing",
    description: "Take a selfie to continue.",
  },

  SHARE_SELECTION_REQUIRED: {
    title: "Select details",
    description: "Choose at least one detail to continue.",
  },

  SHARE_SELECTION_INVALID_FIELD: {
    title: "Invalid selection",
    description:
      "Some selected details aren’t available. Review and try again.",
  },

  SHARE_SELECTION_MISSING_REQUIRED: {
    title: "Required details missing",
    description: "You must keep required details selected.",
  },

  document_authenticity_failed: {
    title: "Document check failed",
    description:
      "We couldn’t verify your document. Try again or use a different one.",
  },

  document_active_authentication_failed: {
    title: "Document check failed",
    description:
      "We couldn’t confirm your document chip. Try again or use a different one.",
  },

  document_chip_authentication_failed: {
    title: "Document check failed",
    description:
      "We couldn’t confirm your document chip. Try again or use a different one.",
  },

  document_anti_cloning_attestation_failed: {
    title: "Document check failed",
    description:
      "We couldn’t confirm this scan came from a trusted device. Try again on the same device or contact support.",
  },

  selfie_face_mismatch: {
    title: "Face doesn’t match",
    description: "Your selfie doesn’t match your document photo. Try again.",
  },
} as const;

export type ErrorMessages = LocalizedDictionary<typeof ERROR_MESSAGES>;
export type ErrorMessageKey = keyof ErrorMessages;

const ERROR_MESSAGES_FR: ErrorMessages = {
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

  SELFIE_DATA_PHASE_REQUIRED: {
    title: "Selfie requis",
    description: "Prenez un selfie pour continuer.",
  },

  SELFIE_REQUIRED_DATA_MISSING: {
    title: "Selfie manquant",
    description: "Prenez un selfie pour continuer.",
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
      "Votre selfie ne correspond pas à la photo de votre document. Réessayez.",
  },
};

const ERROR_MESSAGES_BY_LOCALE: Record<Locale, ErrorMessages> = {
  en: ERROR_MESSAGES,
  fr: ERROR_MESSAGES_FR,
};

/**
 * Return the error-messages dictionary for `locale`, falling back to the
 * default (English) when a locale has not yet been translated. End-user
 * surfaces (apps/verify) should look up the negotiated locale via the React
 * i18n provider; non-localized surfaces (apps/api, apps/platform) keep
 * using the `ERROR_MESSAGES` constant directly.
 */
export function getErrorMessages(locale: Locale): ErrorMessages {
  return (
    ERROR_MESSAGES_BY_LOCALE[locale] ?? ERROR_MESSAGES_BY_LOCALE[DEFAULT_LOCALE]
  );
}
