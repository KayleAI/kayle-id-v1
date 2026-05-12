import type { VERIFY_HANDOFF_COPY } from "../en/verify-handoff-copy";
import type { LocalizedDictionary } from "../i18n";

type VerifyHandoffCopy = LocalizedDictionary<typeof VERIFY_HANDOFF_COPY>;

/** French translation of the verify-handoff copy. */
export const VERIFY_HANDOFF_COPY_FR: VerifyHandoffCopy = {
  head: {
    pageTitle: "Vérification Kayle ID",
    pageDescription: "Vérifiez votre identité avec Kayle ID",
  },

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
