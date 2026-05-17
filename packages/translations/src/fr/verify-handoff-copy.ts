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
      pageTitle: "Demandes de confidentialité Kayle ID",
      pageDescription:
        "Retirez votre consentement ou demandez l’accès et la suppression des données liées à une vérification Kayle ID",
    },
    linkLabel: "Retirer cette vérification",
    heading: "Demandes de confidentialité pour cette vérification",
    description:
      "Kayle peut arrêter le traitement côté Kayle pour cette vérification. Pour les données déjà reçues par l’organisation, contactez directement l’organisation. Vous n’avez pas besoin d’un compte Kayle.",
    scopeTitle: "Référence pour cette demande",
    scopeDescription:
      "Ajoutez cette référence pour que Kayle ID retrouve la session sans vous demander de créer un compte.",
    sessionIdLabel: "ID de session",
    attemptIdLabel: "ID de la dernière tentative",
    attemptUnavailable: "Pas encore disponible",
    organizationLabel: "Organisation",
    withdrawTitle: "Retirer cette vérification",
    withdrawDescriptionWithToken:
      "Ce lien contient le jeton d’annulation de session, Kayle peut donc arrêter le traitement en attente et supprimer les charges utiles non livrées lorsque c’est possible.",
    withdrawDescriptionWithoutToken:
      "Ce lien ne contient pas de jeton d’annulation. Vous pouvez tout de même envoyer une demande de confidentialité avec la référence de session ci-dessous.",
    cancelButton: "Retirer cette vérification",
    cancelPendingButton: "Retrait en cours…",
    cancelSuccess:
      "Kayle a enregistré cette demande et arrêté le traitement côté Kayle lorsque c’est possible.",
    cancelError:
      "Nous n’avons pas pu retirer cette vérification depuis ce lien.",
    requestTitle: "Demander la suppression ou l’accès aux données",
    requestDescription:
      "Utilisez ces liens d’e-mail préremplis pour les demandes de suppression, de retrait ou d’accès aux données. Le message inclut la référence de session.",
    kayleEmailButton: "Envoyer un e-mail à l’équipe confidentialité Kayle",
    rpEmailButton: "Envoyer un e-mail à {organization}",
    loading: "Chargement de la référence de session…",
    loadError:
      "Nous n’avons pas pu charger toute la référence de session, mais l’ID de session dans l’URL peut tout de même être utilisé pour une demande.",
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
        title: "Annulée",
        description: "Cette vérification a été annulée avant d’être terminée.",
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
        title: "Vérification Kayle terminée",
        description:
          "La vérification Kayle s’est terminée sur votre téléphone.",
      },

      finishedHeaderDescription: "Cette vérification est terminée.",
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
        "Partage uniquement le résultat de la vérification Kayle et les informations que vous choisissez de partager avec ",
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
        "J’autorise Kayle ID à partager le résultat de la vérification Kayle et les informations que je choisis de partager avec ",
      bulletShareFullSuffix: "",
      bulletShareAgeOnlyPrefix: "J’autorise Kayle ID à partager ",
      bulletShareAgeOnlyEmphasis: "uniquement",
      bulletShareAgeOnlyMiddle: " si j’ai {ageLabel} avec ",
      bulletShareAgeOnlySuffix: " — aucun autre détail",

      claimManifestTitle: "Informations demandées",
      claimManifestDescription:
        "Vérifiez ce que cette organisation demande à Kayle ID de contrôler ou de partager avant toute lecture de votre document.",
      requiredClaimsTitle: "Informations requises",
      requiredClaimsDescription:
        "Elles doivent rester sélectionnées pour continuer cette vérification.",
      optionalClaimsTitle: "Informations facultatives",
      optionalClaimsDescription:
        "Vous pourrez choisir de les partager ou non plus tard dans l’application Kayle ID.",
      securityClaimsTitle: "Contrôles de sécurité",
      securityClaimsDescription:
        "Kayle ID les utilise pour éviter les contrôles de document dupliqués ou rejoués.",
      ageOnlyClaimsTitle: "Résultat d’âge uniquement",
      ageOnlyClaimsDescription:
        "Seule une réponse par oui ou par non sur l’âge est partagée pour cette partie de la vérification.",
      requiredBadge: "Requis",
      optionalBadge: "Facultatif",

      documentProcessingConsentFull:
        "Je consens à ce que Kayle ID lise les données de mon document pour cette vérification.",
      documentProcessingConsentAgeOnly:
        "Je consens à ce que Kayle ID lise les données de mon document pour vérifier mon âge.",
      biometricConsent:
        "Je consens à ce que Kayle ID capture et traite mon selfie pour confirmer que je suis bien le détenteur du document.",
      shareClaimsConsentFull:
        "Je consens à ce que Kayle ID partage le résultat de cette vérification et les informations sélectionnées avec {organization}.",
      shareClaimsConsentAgeOnly:
        "Je consens à ce que Kayle ID partage uniquement si j’ai {ageLabel} avec {organization}.",
      termsAcknowledgementPrefix: "J’accepte les ",
      termsAcknowledgementSuffix: ".",
      privacyAcknowledgementPrefix: "J’ai lu l’",
      privacyAcknowledgementSuffix: ".",

      agreementPrefix: "J’accepte les ",
      agreementMiddle: " et l’",
      agreementSuffix: " et je consens à la vérification d’identité.",
      termsOfServiceLink: "Conditions de service",
      privacyNoticeLink: "Avis de confidentialité",

      startButtonFull: "Démarrer la vérification",
      startButtonAgeOnly: "Confirmer mon âge",
      startButtonPending: "Démarrage…",
      declineButton: "Je ne consens pas",
      backButton: "Retour",
      submitError:
        "Nous n’avons pas pu enregistrer votre consentement. Vérifiez votre connexion et réessayez.",
      refusalCancelError:
        "Nous n’avons pas pu annuler la session depuis ce lien, mais aucun nouveau traitement Kayle ID ne démarrera depuis cette page.",
      refusalHeading: "Vérification arrêtée",
      refusalDescription:
        "Kayle ID ne poursuivra pas cette vérification. Contactez {organization} pour utiliser une autre voie ou demander un examen.",
      refusalContactButton: "Contacter {organization}",
      refusalBackButton: "Relire l’avis",
      defaultRpName: "cette organisation",
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
