import { DEFAULT_LOCALE, type Locale, type LocalizedDictionary } from "./i18n";

/**
 * English source of truth. New languages are added by registering a
 * dictionary with the same shape in `VERIFY_HANDOFF_COPY_BY_LOCALE` below.
 */
export const VERIFY_HANDOFF_COPY = {
  actions: {
    cancel: "Cancel",
    closeThisPage: "Close this page",
    continueNow: "Continue",
    openKayleIdApp: "Open Kayle ID",
    tryAgain: "Try again",
  },

  cancelDialog: {
    title: "Cancel this check?",
    description: "This will stop the check. You can start a new one later.",
    confirm: "Yes, cancel",
    dismiss: "Keep going",
  },

  handoff: {
    cancelError: "Unable to cancel.",
    loadStatusError: "Unable to load status.",
    refreshError: "Unable to generate QR code.",
    errorMessageTitle: "Unable to generate QR code",
    errorMessageDescription: "Check your internet connection and try again.",
  },

  screens: {
    connected: {
      headerTitle: "Continue on your phone",
      headerDescription: "Your phone is now connected.",
      messageTitle: "In progress",
      messageDescription:
        "Finish the steps in the Kayle ID app. This page will update automatically.",
    },

    initial: {
      headerTitle: "Open Kayle ID on your phone",
      headerDescription: "This check continues in the Kayle ID app.",
      messageTitle: "Use your phone to continue",
      defaultMessageDescription:
        "Scan the QR code with the phone you want to use.",
      iosMessageDescription: "Open the app on this device to continue.",
    },

    retryableFailure: {
      headerTitle: "Try again on your phone",
      headerDescription: "This check must stay on the device that started it.",
      messageTitle: "Try again",
      messageDescription:
        "It didn’t complete successfully. Retry on the same device, or cancel it there.",
    },

    sameDeviceOnly: {
      headerTitle: "Continue on your phone",
      headerDescription: "This check is locked to the device that started it.",
      messageTitle: "Waiting for your device",
      messageDescription:
        "Open Kayle ID on that device to continue. A new QR code isn’t available.",
    },

    terminal: {
      cancelled: {
        title: "Cancelled",
        description: "This check was cancelled before it finished.",
      },

      expired: {
        title: "Expired",
        description: "This check expired before it finished.",
      },

      failed: {
        title: "Failed",
        description: "The latest attempt didn’t pass.",
      },

      documentAuthenticityFailed: {
        title: "Document check failed",
        description: "We couldn’t verify your document.",
      },

      documentActiveAuthenticationFailed: {
        title: "Document check failed",
        description: "We couldn’t confirm your document chip.",
      },

      documentChipAuthenticationFailed: {
        title: "Document check failed",
        description: "We couldn’t confirm your document chip.",
      },

      selfieFaceMismatch: {
        title: "Face doesn’t match",
        description: "Your selfie doesn’t match your document photo.",
      },

      success: {
        title: "Complete",
        description: "Finished successfully on your phone.",
      },

      finishedHeaderDescription: "This check is complete.",
      outcomeMessageTitle: "Result",
      redirectHeaderDescription: "Continue now or wait to be redirected.",
      successMessageTitle: "Finished on your phone",
      youCanCloseDescription: "You can close this page.",
    },
  },
} as const;

export type VerifyHandoffCopy = LocalizedDictionary<typeof VERIFY_HANDOFF_COPY>;

const VERIFY_HANDOFF_COPY_FR: VerifyHandoffCopy = {
  actions: {
    cancel: "Annuler",
    closeThisPage: "Fermer cette page",
    continueNow: "Continuer",
    openKayleIdApp: "Ouvrir Kayle ID",
    tryAgain: "Réessayer",
  },

  cancelDialog: {
    title: "Annuler cette vérification ?",
    description:
      "Cela arrêtera la vérification. Vous pourrez en démarrer une nouvelle plus tard.",
    confirm: "Oui, annuler",
    dismiss: "Continuer",
  },

  handoff: {
    cancelError: "Impossible d’annuler.",
    loadStatusError: "Impossible de charger l’état.",
    refreshError: "Impossible de générer le code QR.",
    errorMessageTitle: "Impossible de générer le code QR",
    errorMessageDescription: "Vérifiez votre connexion internet et réessayez.",
  },

  screens: {
    connected: {
      headerTitle: "Continuez sur votre téléphone",
      headerDescription: "Votre téléphone est maintenant connecté.",
      messageTitle: "En cours",
      messageDescription:
        "Terminez les étapes dans l’application Kayle ID. Cette page se mettra à jour automatiquement.",
    },

    initial: {
      headerTitle: "Ouvrez Kayle ID sur votre téléphone",
      headerDescription:
        "Cette vérification continue dans l’application Kayle ID.",
      messageTitle: "Utilisez votre téléphone pour continuer",
      defaultMessageDescription:
        "Scannez le code QR avec le téléphone que vous souhaitez utiliser.",
      iosMessageDescription:
        "Ouvrez l’application sur cet appareil pour continuer.",
    },

    retryableFailure: {
      headerTitle: "Réessayez sur votre téléphone",
      headerDescription:
        "Cette vérification doit rester sur l’appareil qui l’a démarrée.",
      messageTitle: "Réessayer",
      messageDescription:
        "Elle ne s’est pas terminée avec succès. Réessayez sur le même appareil, ou annulez-la depuis cet appareil.",
    },

    sameDeviceOnly: {
      headerTitle: "Continuez sur votre téléphone",
      headerDescription:
        "Cette vérification est verrouillée sur l’appareil qui l’a démarrée.",
      messageTitle: "En attente de votre appareil",
      messageDescription:
        "Ouvrez Kayle ID sur cet appareil pour continuer. Aucun nouveau code QR n’est disponible.",
    },

    terminal: {
      cancelled: {
        title: "Annulée",
        description: "Cette vérification a été annulée avant d’être terminée.",
      },

      expired: {
        title: "Expirée",
        description: "Cette vérification a expiré avant d’être terminée.",
      },

      failed: {
        title: "Échec",
        description: "La dernière tentative n’a pas abouti.",
      },

      documentAuthenticityFailed: {
        title: "Échec de la vérification du document",
        description: "Nous n’avons pas pu vérifier votre document.",
      },

      documentActiveAuthenticationFailed: {
        title: "Échec de la vérification du document",
        description: "Nous n’avons pas pu confirmer la puce de votre document.",
      },

      documentChipAuthenticationFailed: {
        title: "Échec de la vérification du document",
        description: "Nous n’avons pas pu confirmer la puce de votre document.",
      },

      selfieFaceMismatch: {
        title: "Le visage ne correspond pas",
        description:
          "Votre selfie ne correspond pas à la photo de votre document.",
      },

      success: {
        title: "Terminée",
        description: "Terminée avec succès sur votre téléphone.",
      },

      finishedHeaderDescription: "Cette vérification est terminée.",
      outcomeMessageTitle: "Résultat",
      redirectHeaderDescription:
        "Continuez maintenant ou attendez d’être redirigé.",
      successMessageTitle: "Terminée sur votre téléphone",
      youCanCloseDescription: "Vous pouvez fermer cette page.",
    },
  },
};

const VERIFY_HANDOFF_COPY_BY_LOCALE: Record<Locale, VerifyHandoffCopy> = {
  en: VERIFY_HANDOFF_COPY,
  fr: VERIFY_HANDOFF_COPY_FR,
};

/**
 * Return the verify-handoff copy dictionary for `locale`, falling back to
 * the default (English) when a locale has not yet been translated. Callers
 * pass the negotiated locale from `negotiateLocale` / the React i18n
 * provider — this function does not negotiate on its own.
 */
export function getVerifyHandoffCopy(locale: Locale): VerifyHandoffCopy {
  return (
    VERIFY_HANDOFF_COPY_BY_LOCALE[locale] ??
    VERIFY_HANDOFF_COPY_BY_LOCALE[DEFAULT_LOCALE]
  );
}
