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

    explain: {
      headline: "Verify your identity with Kayle ID",
      intro:
        "Kayle ID lets you verify your identity using your document's chip and a selfie.",
      processTitle: "This process:",
      processBulletAuthentic: "Confirms that your document is genuine",
      processBulletHolder: "Confirms that you are the document holder",
      processBulletSharingPrefix:
        "Shares only the verification result and details you choose to share with ",
      processBulletSharingSuffix: "",
      kayleIdTitle: "Kayle ID:",
      kayleIdBulletNoStorage: "Does not store your document or selfie",
      kayleIdBulletNoAccount: "Does not create an account for you",
      kayleIdBulletSessionScoped:
        "Processes data only for this verification session",
      continueButton: "Continue",

      ageOnly: {
        headlineWithThreshold: "Confirm you're over {threshold}",
        headlineGeneric: "Confirm your age",
        ageLabelWithThreshold: "over {threshold}",
        ageLabelGeneric: "old enough",
        introPrefix: "",
        introSuffix:
          " only needs to know whether you're {ageLabel} — not your name, date of birth, or any other personal details. Kayle ID lets you prove that privately, using your document and a selfie.",
        whatGetsSharedTitle: "What gets shared:",
        yesNoBulletPrefix: "A single yes-or-no answer: ",
        yesNoBulletQuestion: "are you {ageLabel}?",
        nothingElseBullet:
          "Nothing else — not your name, date of birth, document number, nationality, or photo",
      },
    },

    consent: {
      heading: "Your consent is required",
      subheadingFull: "To continue, you must agree to the following:",
      subheadingAgeOnly: "To prove your age, you must agree to the following:",

      bulletReadDocFull: "I allow Kayle ID to read data from my document",
      bulletReadDocAgeOnly:
        "I allow Kayle ID to read my document to check my age",
      bulletSelfie:
        "I allow Kayle ID to capture a selfie to confirm I am the document holder",
      bulletShareFullPrefix:
        "I allow Kayle ID to share the verification result and details I choose to share with ",
      bulletShareFullSuffix: "",
      bulletShareAgeOnlyPrefix: "I allow Kayle ID to share ",
      bulletShareAgeOnlyEmphasis: "only",
      bulletShareAgeOnlyMiddle: " whether I am {ageLabel} with ",
      bulletShareAgeOnlySuffix: " — no other details",

      agreementPrefix: "I agree to the ",
      agreementMiddle: " and ",
      agreementSuffix: " and consent to identity verification.",
      termsOfServiceLink: "Terms of Service",
      privacyNoticeLink: "Privacy Notice",

      startButtonFull: "Start verification",
      startButtonAgeOnly: "Confirm my age",
      backButton: "Back",
    },

    notFound: {
      headerTitle: "Page Not Found",
      headerDescription: "The page you are looking for does not exist.",
      messageTitle: "We couldn't find the page you were looking for",
      messageDescription: "Please check the URL you followed and try again.",
      goBackButton: "Go back to the previous page",
    },

    sessionError: {
      headerTitle: "Session Error",
      headerDescription: "An error occurred while loading the session.",
    },
  },

  org: {
    aboutDialogTitle: "About {name}",
    aboutDialogDescription:
      "To help protect you, we're showing you some information about the organization requesting this check.",

    soleTraderNameLabel: "Full name",
    soleTraderJurisdictionLabel: "Country",
    soleTraderRegistrationLabel: "Tax / trader ID",
    businessNameLabel: "Legal name",
    businessJurisdictionLabel: "Registered in",
    businessRegistrationLabel: "Registration number",

    websiteLinkLabel: "Website",
    privacyPolicyLinkLabel: "Privacy policy",
    termsOfServiceLinkLabel: "Terms of service",
    opensInNewTabLabel: "Opens in a new tab",

    verifiedDomainTitleSingular: "Verified domain",
    verifiedDomainTitlePlural: "Verified domains",
    verifiedDomainDescriptionSingular:
      "Kayle ID confirmed control of this domain. The website and policy links shown here all point to it.",
    verifiedDomainDescriptionPlural:
      "Kayle ID confirmed control of these domains. The website and policy links shown here all point to them.",

    ownerVerifiedTitle: "Owner ID check completed",
    ownerVerifiedDescription:
      "The people running this organization have completed Kayle ID's owner identity check.",
    ownerNotVerifiedTitle: "Owner ID check not completed",
    ownerNotVerifiedDescription:
      "Kayle ID has not independently verified the people running this organization. Only continue if you trust this request.",
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

    explain: {
      headline: "Vérifiez votre identité avec Kayle ID",
      intro:
        "Kayle ID vous permet de vérifier votre identité à l’aide de la puce de votre document et d’un selfie.",
      processTitle: "Ce processus :",
      processBulletAuthentic: "Confirme que votre document est authentique",
      processBulletHolder:
        "Confirme que vous êtes bien le détenteur du document",
      processBulletSharingPrefix:
        "Partage uniquement le résultat de la vérification et les informations que vous choisissez de partager avec ",
      processBulletSharingSuffix: "",
      kayleIdTitle: "Kayle ID :",
      kayleIdBulletNoStorage: "Ne stocke ni votre document ni votre selfie",
      kayleIdBulletNoAccount: "Ne crée pas de compte pour vous",
      kayleIdBulletSessionScoped:
        "Traite les données uniquement pour cette session de vérification",
      continueButton: "Continuer",

      ageOnly: {
        headlineWithThreshold:
          "Confirmez que vous avez plus de {threshold} ans",
        headlineGeneric: "Confirmez votre âge",
        ageLabelWithThreshold: "plus de {threshold} ans",
        ageLabelGeneric: "suffisamment âgé(e)",
        introPrefix: "",
        introSuffix:
          " a uniquement besoin de savoir si vous avez {ageLabel} — pas votre nom, votre date de naissance, ni aucune autre information personnelle. Kayle ID vous permet de le prouver de manière privée, à l’aide de votre document et d’un selfie.",
        whatGetsSharedTitle: "Ce qui est partagé :",
        yesNoBulletPrefix: "Une seule réponse par oui ou par non : ",
        yesNoBulletQuestion: "avez-vous {ageLabel} ?",
        nothingElseBullet:
          "Rien d’autre — pas votre nom, votre date de naissance, votre numéro de document, votre nationalité, ni votre photo",
      },
    },

    consent: {
      heading: "Votre consentement est requis",
      subheadingFull: "Pour continuer, vous devez accepter ce qui suit :",
      subheadingAgeOnly:
        "Pour prouver votre âge, vous devez accepter ce qui suit :",

      bulletReadDocFull:
        "J’autorise Kayle ID à lire les données de mon document",
      bulletReadDocAgeOnly:
        "J’autorise Kayle ID à lire mon document pour vérifier mon âge",
      bulletSelfie:
        "J’autorise Kayle ID à prendre un selfie pour confirmer que je suis bien le détenteur du document",
      bulletShareFullPrefix:
        "J’autorise Kayle ID à partager le résultat de la vérification et les informations que je choisis de partager avec ",
      bulletShareFullSuffix: "",
      bulletShareAgeOnlyPrefix: "J’autorise Kayle ID à partager ",
      bulletShareAgeOnlyEmphasis: "uniquement",
      bulletShareAgeOnlyMiddle: " si j’ai {ageLabel} avec ",
      bulletShareAgeOnlySuffix: " — aucun autre détail",

      agreementPrefix: "J’accepte les ",
      agreementMiddle: " et l’",
      agreementSuffix: " et je consens à la vérification d’identité.",
      termsOfServiceLink: "Conditions de service",
      privacyNoticeLink: "Avis de confidentialité",

      startButtonFull: "Démarrer la vérification",
      startButtonAgeOnly: "Confirmer mon âge",
      backButton: "Retour",
    },

    notFound: {
      headerTitle: "Page introuvable",
      headerDescription: "La page que vous cherchez n’existe pas.",
      messageTitle: "Nous n’avons pas trouvé la page que vous cherchiez",
      messageDescription: "Vérifiez l’URL que vous avez suivie et réessayez.",
      goBackButton: "Retourner à la page précédente",
    },

    sessionError: {
      headerTitle: "Erreur de session",
      headerDescription:
        "Une erreur s’est produite lors du chargement de la session.",
    },
  },

  org: {
    aboutDialogTitle: "À propos de {name}",
    aboutDialogDescription:
      "Pour vous aider à vous protéger, nous vous montrons quelques informations sur l’organisation à l’origine de cette vérification.",

    soleTraderNameLabel: "Nom complet",
    soleTraderJurisdictionLabel: "Pays",
    soleTraderRegistrationLabel: "Identifiant fiscal / professionnel",
    businessNameLabel: "Dénomination légale",
    businessJurisdictionLabel: "Immatriculée à",
    businessRegistrationLabel: "Numéro d’immatriculation",

    websiteLinkLabel: "Site web",
    privacyPolicyLinkLabel: "Politique de confidentialité",
    termsOfServiceLinkLabel: "Conditions de service",
    opensInNewTabLabel: "S’ouvre dans un nouvel onglet",

    verifiedDomainTitleSingular: "Domaine vérifié",
    verifiedDomainTitlePlural: "Domaines vérifiés",
    verifiedDomainDescriptionSingular:
      "Kayle ID a confirmé le contrôle de ce domaine. Les liens vers le site web et les politiques affichés ici pointent tous vers celui-ci.",
    verifiedDomainDescriptionPlural:
      "Kayle ID a confirmé le contrôle de ces domaines. Les liens vers le site web et les politiques affichés ici pointent tous vers ces domaines.",

    ownerVerifiedTitle: "Vérification d’identité du propriétaire effectuée",
    ownerVerifiedDescription:
      "Les personnes qui dirigent cette organisation ont effectué la vérification d’identité du propriétaire de Kayle ID.",
    ownerNotVerifiedTitle:
      "Vérification d’identité du propriétaire non effectuée",
    ownerNotVerifiedDescription:
      "Kayle ID n’a pas vérifié de manière indépendante les personnes qui dirigent cette organisation. Ne continuez que si vous faites confiance à cette demande.",
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
