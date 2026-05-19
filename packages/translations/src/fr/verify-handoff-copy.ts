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
    cancelOrWithdrawConsent: "Annuler ou retirer le consentement",
    closeThisPage: "Fermer cette page",
    continueNow: "Continuer",
    openKayleIdApp: "Ouvrir Kayle ID",
    tryAgain: "Réessayer",
  },

  cancelDialog: {
    title: "Annuler ou retirer le consentement ?",
    description:
      "Cela arrêtera cette vérification et retirera le consentement pour le traitement par Kayle ID.",
    confirm: "Oui, arrêter cette vérification",
    dismiss: "Continuer",
  },

  handoff: {
    cancelError: "Impossible d’annuler.",
    loadStatusError: "Impossible de charger l’état.",
    refreshError: "Impossible de générer le code QR.",
    errorMessageTitle: "Impossible de générer le code QR",
    errorMessageDescription: "Vérifiez votre connexion internet et réessayez.",
  },

  rpFallback: {
    title: "Besoin d’une autre voie ?",
    description:
      "Utilisez l’une des options de secours de cette organisation si Kayle ID n’est pas la bonne méthode pour terminer cette vérification.",
    fallbackIdvLabel: "Utiliser une autre méthode de vérification",
    appealLabel: "Demander un examen",
    contactLabel: "Contacter {organization}",
    complaintsLabel: "Réclamations",
  },

  privacyRequest: {
    head: {
      pageTitle: "Options de confidentialité Kayle ID",
      pageDescription:
        "Retirez votre consentement pour une vérification Kayle ID",
    },
    linkLabel: "Mes options de confidentialité",
    heading: "Options de confidentialité",
    statusHeading: "À propos de cette vérification d’identité",
    terminalHeading: "Cette vérification d’identité est terminée",
    activeDescription:
      "Kayle ID ne conserve que les données temporaires du document et du selfie nécessaires à cette vérification. Retirer le consentement arrête le traitement et supprime tout ce qui est encore conservé pour cette vérification.",
    unavailableActiveDescription:
      "Kayle ID ne peut pas charger l’organisation de cette vérification. Comme la vérification n’est pas terminée, Kayle ID peut encore conserver des données temporaires pour celle-ci.",
    terminalNoDataDescription:
      "Cette vérification d’identité est déjà terminée. Kayle ID n’a plus votre document, votre selfie ni vos informations personnelles pour celle-ci.",
    terminalUndeliveredDescription:
      "Cette vérification d’identité est déjà terminée. Kayle ID n’a plus votre document, votre selfie ni vos informations personnelles. {organization} n’a pas reçu le résultat, et le retrait peut supprimer maintenant le résultat chiffré non livré.",
    terminalDeliveredDescription:
      "Cette vérification d’identité est déjà terminée. Kayle ID n’a plus votre document, votre selfie ni vos informations personnelles. {organization} a déjà reçu vos données.",
    notFoundHeading: "Nous ne trouvons pas cette vérification d’identité",
    notFoundDescription:
      "S’il s’agit de la vérification d’identité que vous avez utilisée, Kayle ID n’a plus votre document, votre selfie ni vos informations personnelles pour celle-ci.",
    withdrawTitle: "Retirer le consentement",
    withdrawDescriptionActive:
      "Kayle ID arrêtera le traitement de cette vérification et supprimera tout ce qui est encore conservé pour celle-ci.",
    withdrawDescriptionTerminal:
      "Kayle ID enregistrera le retrait de votre consentement et supprimera tout résultat chiffré que nous détenons encore pour cette vérification.",
    cancelButton: "Retirer le consentement",
    cancelPendingButton: "Retrait du consentement en cours…",
    cancelSuccess: "Consentement retiré",
    cancelError: "Nous n’avons pas pu retirer le consentement depuis ce lien.",
    organizationRequestTitle:
      "Vos données ont déjà été envoyées à {organization}",
    organizationRequestDescription:
      "{organization} contrôle les données reçues. Contactez cette organisation pour y demander l’accès ou la suppression.",
    rpEmailButton: "Envoyer un e-mail à {organization}",
    learnMoreLink: "En savoir plus sur Kayle ID",
    defaultOrganizationName: "cette organisation",
  },

  screens: {
    connected: {
      headerTitle: "Continuez sur votre téléphone",
      headerDescription: "Votre téléphone est maintenant connecté.",
      messageTitle: "Vérification d’identité en cours",
      messageDescription:
        "Continuez la vérification dans l’application Kayle ID.",
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
        "Kayle ID n’a pas pu confirmer automatiquement cette vérification. Réessayez sur le même appareil, ou annulez-la depuis cet appareil.",
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
        title: "Vérification annulée",
        headerDescription: "Kayle ID ne poursuivra pas cette vérification.",
        messageTitle: "Aucune autre action requise",
        description: "Cette vérification a été arrêtée.",
      },

      expired: {
        title: "Expirée",
        description: "Cette vérification a expiré avant d’être terminée.",
      },

      failed: {
        title: "Vérification non confirmée",
        description:
          "Kayle ID n’a pas pu confirmer automatiquement la dernière tentative.",
      },

      documentAuthenticityFailed: {
        title: "Document non confirmé",
        description:
          "Kayle ID n’a pas pu confirmer automatiquement votre document.",
      },

      documentActiveAuthenticationFailed: {
        title: "Document non confirmé",
        description: "Nous n’avons pas pu confirmer la puce de votre document.",
      },

      documentChipAuthenticationFailed: {
        title: "Document non confirmé",
        description: "Nous n’avons pas pu confirmer la puce de votre document.",
      },

      selfieFaceMismatch: {
        title: "Correspondance du visage non confirmée",
        description:
          "Kayle ID n’a pas pu confirmer automatiquement que votre selfie correspondait à la photo du document.",
      },

      success: {
        title: "Vérification d’identité terminée",
        description:
          "La vérification d’identité a été effectuée avec succès sur votre téléphone.",
      },

      finishedHeaderDescription: "Cette vérification d’identité est terminée.",
      unfinishedHeaderDescription:
        "Cette vérification d’identité ne s’est pas terminée.",
      outcomeMessageTitle: "Résultat",
      redirectHeaderDescription:
        "Continuez maintenant ou attendez d’être redirigé.",
      successMessageTitle: "Terminée sur votre téléphone",
      youCanCloseDescription: "Vous pouvez fermer cette page.",
    },

    explain: {
      headline: "Effectuez une vérification Kayle ID",
      intro:
        "Kayle ID traite une vérification d’assurance d’identité à l’aide de la puce de votre document et d’un selfie.",
      processTitle: "Ce processus :",
      processBulletAuthentic: "Vérifie si votre document est authentique",
      processBulletHolder: "Vérifie si vous êtes bien le détenteur du document",
      processBulletSharingPrefix:
        "Partage uniquement le résultat de la vérification Kayle ID et les informations que vous choisissez de partager avec ",
      processBulletSharingSuffix: "",
      processBulletDecisionPrefix: "Envoie un signal d’assurance d’identité à ",
      processBulletDecisionSuffix:
        " ; cette organisation décide quoi faire du résultat.",
      kayleIdTitle: "Kayle ID :",
      kayleIdBulletNoStorage: "Ne stocke ni votre document ni votre selfie",
      kayleIdBulletNoAccount: "Ne crée pas de compte pour vous",
      kayleIdBulletSessionScoped:
        "Traite les données du document et les données biométriques uniquement pour cette vérification, puis les supprime lorsque la connexion sécurisée se ferme",
      kayleIdBulletRetention:
        "Conserve des métadonnées limitées de session pendant les durées définies dans l’avis de confidentialité",
      kayleIdBulletNoDecision:
        "Ne décide pas si vous recevez le service de l’organisation",
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
      agreementSuffix: " et je consens à cette vérification.",
      termsOfServiceLink: "Conditions de service",
      privacyNoticeLink: "Avis de confidentialité",

      startButtonFull: "Démarrer la vérification",
      startButtonAgeOnly: "Confirmer mon âge",
      startButtonPending: "Démarrage…",
      declineButton: "Je ne consens pas",
      submitError:
        "Nous n’avons pas pu enregistrer votre consentement. Vérifiez votre connexion et réessayez.",
      refusalDialogTitle: "Ne pas consentir ?",
      refusalDialogDescriptionPrefix:
        "Cela arrêtera cette vérification. Contactez ",
      refusalDialogDescriptionSuffix:
        " pour utiliser une autre voie ou demander un examen.",
      refusalDialogConfirm: "Oui, arrêter cette vérification",
      refusalDialogDismiss: "Retour",
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
      "Un propriétaire vérifié a effectué la vérification d’identité du propriétaire de Kayle ID.",
    ownerNotVerifiedTitle:
      "Vérification d’identité du propriétaire non effectuée",
    ownerNotVerifiedDescription:
      "Kayle ID n’a pas vérifié de manière indépendante les personnes qui dirigent cette organisation. Ne continuez que si vous faites confiance à cette demande.",

    report: {
      actionLabel: "Signaler l’organisation",
      title: "Signaler {organization}",
      description:
        "Indiquez à Kayle ID pourquoi cette organisation doit être examinée. Les signalements ne sont envoyés qu’aux administrateurs Kayle.",
      reasonLabel: "Raison",
      reasonPlaceholder: "Sélectionnez une raison",
      detailsLabel: "Plus de détails (facultatif)",
      detailsPlaceholder:
        "Ajoutez tout élément que Kayle devrait connaître lors de l’examen de cette organisation.",
      submitLabel: "Envoyer le signalement",
      submittingLabel: "Envoi…",
      successMessage: "Signalement envoyé. Kayle va l’examiner.",
      errorMessage: "Nous n’avons pas pu envoyer ce signalement. Réessayez.",
      reasons: {
        deceptiveUse: "Utilisation trompeuse",
        discriminationOrEligibilityConcern:
          "Préoccupation liée à la discrimination ou à l’éligibilité",
        impersonation: "Usurpation d’identité",
        missingFallbackOrAppeal: "Aucune voie alternative ou d’appel",
        other: "Autre",
        privacyConcern: "Préoccupation relative à la confidentialité",
      },
    },
  },
};
