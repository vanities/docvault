/**
 * DNA Traits & Health Parser
 *
 * Pure-TypeScript SNP analyzer for AncestryDNA / 23andMe raw data. Zero
 * network calls, zero LLM — every interpretation is a deterministic function
 * of 2–3 discrete allele inputs.
 *
 * Public API:
 *   parseDNA(content: string): DNAParseResult
 *
 * The SNP tables and interpretation functions below originated in
 * scripts/dna-traits.ts (a local CLI tool). They're committed here because
 * the data is all from published scientific literature (HERC2/OCA2 eye
 * color, MC1R hair variants, APOE Alzheimer's risk, etc) — no personal data.
 */

export interface TraitSNP {
  rsid: string;
  gene: string;
  trait: string;
  category: string;
  interpret: (a1: string, a2: string) => string;
}

// ============================================================
//  SECTION 1: FUN TRAITS
// ============================================================

export const TRAIT_SNPS: TraitSNP[] = [
  // -------- Appearance: Eyes --------
  {
    rsid: 'rs12913832',
    gene: 'HERC2/OCA2',
    trait: 'Eye Color (primary)',
    category: 'Appearance',
    interpret: (a1, a2) => {
      if (a1 === 'G' && a2 === 'G') return 'Likely blue or light-colored eyes';
      if (a1 === 'A' && a2 === 'A') return 'Likely brown eyes';
      return 'Variable — could be green, hazel, or light brown';
    },
  },
  {
    rsid: 'rs7495174',
    gene: 'OCA2',
    trait: 'Eye Color (green vs blue modifier)',
    category: 'Appearance',
    interpret: (a1, a2) => {
      if (a1 === 'G' && a2 === 'G') return 'Associated with green/hazel eyes';
      if (a1 === 'A' && a2 === 'A') return 'Associated with blue eyes (with other factors)';
      return 'Mixed — eye color depends on many SNPs together';
    },
  },
  {
    rsid: 'rs1800407',
    gene: 'OCA2 (R419Q)',
    trait: 'Eye Color (green/hazel modifier)',
    category: 'Appearance',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Associated with green or hazel eyes (overrides some brown-eye signals)';
      if (a1 === 'C' && a2 === 'C') return 'No green-eye modifier at this position';
      return 'One copy — may contribute to green or hazel coloring';
    },
  },
  {
    rsid: 'rs1393350',
    gene: 'TYR',
    trait: 'Eye Color (blue-eye contributor)',
    category: 'Appearance',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A') return 'Associated with lighter eye color';
      if (a1 === 'G' && a2 === 'G') return 'No lightening effect at this locus';
      return 'One copy — mild lightening influence';
    },
  },

  // -------- Appearance: Hair --------
  {
    rsid: 'rs1805007',
    gene: 'MC1R (R151C)',
    trait: 'Red Hair Variant 1',
    category: 'Appearance',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T') return 'Two copies — likely red/auburn hair';
      if (a1 === 'C' && a2 === 'C') return 'No red hair variant at this position';
      return 'One copy — carrier, may have reddish tints or freckling';
    },
  },
  {
    rsid: 'rs1805008',
    gene: 'MC1R (R160W)',
    trait: 'Red Hair Variant 2',
    category: 'Appearance',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T') return 'Two copies of R160W — strong red hair association';
      if (a1 === 'C' && a2 === 'C') return 'No variant at this position';
      return 'One copy — carrier for red hair';
    },
  },
  {
    rsid: 'rs1805009',
    gene: 'MC1R (D294H)',
    trait: 'Red Hair Variant 3',
    category: 'Appearance',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A') return 'Two copies of D294H — strong red/auburn association';
      if (a1 === 'G' && a2 === 'G') return 'No variant at this position';
      return 'One copy — carrier. Combined with other MC1R variants, increases red hair chance.';
    },
  },
  {
    rsid: 'rs12821256',
    gene: 'KITLG',
    trait: 'Blonde Hair',
    category: 'Appearance',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C')
        return 'Associated with blonde hair (common in Northern Europeans)';
      if (a1 === 'T' && a2 === 'T') return 'No blonde association at this locus';
      return 'One copy — some blonde influence';
    },
  },
  {
    rsid: 'rs11803731',
    gene: 'TCHH (trichohyalin)',
    trait: 'Hair Curliness',
    category: 'Appearance',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T') return 'Associated with curlier hair';
      if (a1 === 'A' && a2 === 'A') return 'Associated with straighter hair';
      return 'Intermediate — wavy hair likely. Hair texture is very polygenic.';
    },
  },
  {
    rsid: 'rs3827760',
    gene: 'EDAR (V370A)',
    trait: 'Hair Thickness & Tooth Shape',
    category: 'Appearance',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C')
        return 'Derived variant — thicker hair, shovel-shaped incisors, more sweat glands. Nearly universal in East Asian populations.';
      if (a1 === 'T' && a2 === 'T')
        return 'Ancestral variant — typical for European/African populations';
      return 'One copy — intermediate hair thickness';
    },
  },
  {
    rsid: 'rs2180439',
    gene: 'chr20p11',
    trait: 'Male Pattern Baldness Risk',
    category: 'Appearance',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C')
        return 'Higher risk for androgenetic alopecia (male pattern baldness)';
      if (a1 === 'T' && a2 === 'T') return 'Lower risk at this locus';
      return 'Moderate risk — baldness is highly polygenic with many contributing loci';
    },
  },

  // -------- Appearance: Skin --------
  {
    rsid: 'rs1426654',
    gene: 'SLC24A5',
    trait: 'Skin Pigmentation (primary)',
    category: 'Appearance',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'Lighter skin variant (nearly fixed in European populations)';
      if (a1 === 'G' && a2 === 'G')
        return 'Ancestral variant (common in African/East Asian populations)';
      return 'Mixed — intermediate pigmentation influence';
    },
  },
  {
    rsid: 'rs16891982',
    gene: 'SLC45A2 (MATP)',
    trait: 'Skin Pigmentation (secondary)',
    category: 'Appearance',
    interpret: (a1, a2) => {
      if (a1 === 'G' && a2 === 'G') return 'Lighter skin/hair pigmentation variant';
      if (a1 === 'C' && a2 === 'C') return 'Ancestral variant — darker pigmentation influence';
      return 'One copy — intermediate effect';
    },
  },
  {
    rsid: 'rs12203592',
    gene: 'IRF4',
    trait: 'Freckling & Sun Sensitivity',
    category: 'Appearance',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Strongly associated with freckling, sun sensitivity, and lighter features';
      if (a1 === 'C' && a2 === 'C') return 'Less likely to freckle';
      return 'One copy — moderate freckling tendency';
    },
  },
  {
    rsid: 'rs1042602',
    gene: 'TYR (S192Y)',
    trait: 'Tanning Ability',
    category: 'Appearance',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A') return 'Reduced tanning ability, lighter skin';
      if (a1 === 'C' && a2 === 'C') return 'Better tanning response';
      return 'Intermediate tanning ability';
    },
  },
  {
    rsid: 'rs2223049',
    gene: 'PAX3',
    trait: 'Unibrow Tendency',
    category: 'Appearance',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C') return 'Higher tendency for connected eyebrows (synophrys)';
      if (a1 === 'T' && a2 === 'T') return 'Lower unibrow tendency';
      return 'Moderate — one contributing allele';
    },
  },

  // -------- Taste & Smell --------
  {
    rsid: 'rs72921001',
    gene: 'OR6A2',
    trait: 'Cilantro Taste Perception',
    category: 'Taste & Smell',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C') return 'Cilantro probably tastes normal to you';
      if (a1 === 'A' && a2 === 'A')
        return "Cilantro likely tastes like soap — you're not imagining it!";
      return 'Mild sensitivity — cilantro might taste a bit soapy sometimes';
    },
  },
  {
    rsid: 'rs713598',
    gene: 'TAS2R38 (A49P)',
    trait: 'Bitter Taste Perception (PTC/PROP)',
    category: 'Taste & Smell',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C')
        return 'Taster — you can taste PTC/PROP bitter compounds (broccoli, Brussels sprouts taste more bitter)';
      if (a1 === 'G' && a2 === 'G')
        return 'Non-taster — these bitter compounds are invisible to you';
      return 'Intermediate taster — some sensitivity to bitter compounds';
    },
  },
  {
    rsid: 'rs10246939',
    gene: 'TAS2R38 (I296V)',
    trait: 'Bitter Taste (second marker)',
    category: 'Taste & Smell',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C') return 'Taster haplotype — confirms bitter sensitivity';
      if (a1 === 'T' && a2 === 'T') return 'Non-taster haplotype';
      return 'Intermediate';
    },
  },
  {
    rsid: 'rs4481887',
    gene: 'OR2M7',
    trait: 'Asparagus Smell Detection',
    category: 'Taste & Smell',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A') return 'You can likely smell asparagus metabolites in urine';
      if (a1 === 'G' && a2 === 'G')
        return "You probably can't detect asparagus smell — blissful ignorance";
      return 'Some ability to detect asparagus smell';
    },
  },
  {
    rsid: 'rs6232',
    gene: 'PCSK1',
    trait: 'Sweet Taste Preference',
    category: 'Taste & Smell',
    interpret: (a1, a2) => {
      if (a1 === 'G' && a2 === 'G') return 'Typical sweet preference';
      if (a1 === 'A' && a2 === 'A') return 'May have a stronger sweet tooth';
      return 'Slightly increased sweet preference';
    },
  },

  // -------- Body & Physiology --------
  {
    rsid: 'rs17822931',
    gene: 'ABCC11',
    trait: 'Earwax Type (and Body Odor)',
    category: 'Body & Physiology',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C')
        return 'Dry earwax, less body odor (common in East Asian populations). You might not need deodorant!';
      if (a1 === 'T' && a2 === 'T')
        return 'Wet earwax, typical body odor (common in European/African populations)';
      return 'Wet earwax (T is dominant)';
    },
  },
  {
    rsid: 'rs10427255',
    gene: 'near ZEB2',
    trait: 'Photic Sneeze Reflex (ACHOO)',
    category: 'Body & Physiology',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C') return 'Less likely to sneeze when looking at bright light';
      if (a1 === 'T' && a2 === 'T')
        return 'More likely to sneeze when stepping into sunlight (ACHOO syndrome!)';
      return 'Moderate chance of photic sneeze reflex';
    },
  },
  {
    rsid: 'rs4988235',
    gene: 'MCM6/LCT',
    trait: 'Lactose Tolerance',
    category: 'Body & Physiology',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Likely lactose tolerant (can digest milk into adulthood)';
      if (a1 === 'C' && a2 === 'C')
        return 'Likely lactose intolerant (the ancestral & global majority state)';
      return 'Likely lactose tolerant (one persistence allele is enough)';
    },
  },
  {
    rsid: 'rs1815739',
    gene: 'ACTN3 (R577X)',
    trait: 'Muscle Fiber Type',
    category: 'Body & Physiology',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C')
        return 'More fast-twitch muscle fibers — sprint/power type. Common in elite sprinters.';
      if (a1 === 'T' && a2 === 'T')
        return 'No functional alpha-actinin-3 — endurance type. Common in elite distance runners.';
      return 'Mix of fast and slow-twitch — all-rounder';
    },
  },
  {
    rsid: 'rs1042713',
    gene: 'ADRB2 (Arg16Gly)',
    trait: 'Exercise Response & Bronchodilation',
    category: 'Body & Physiology',
    interpret: (a1, a2) => {
      if (a1 === 'G' && a2 === 'G')
        return 'Gly/Gly — enhanced response to endurance training. Also better bronchodilator response (relevant for asthma).';
      if (a1 === 'A' && a2 === 'A') return 'Arg/Arg — different exercise adaptation pattern';
      return 'Heterozygous — intermediate exercise response';
    },
  },
  {
    rsid: 'rs1801260',
    gene: 'CLOCK (3111T/C)',
    trait: 'Chronotype (Morning vs Night)',
    category: 'Body & Physiology',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C')
        return 'Night owl tendency — you may prefer later bedtimes and wake times';
      if (a1 === 'T' && a2 === 'T')
        return 'Morning lark tendency — earlier natural sleep/wake cycle';
      return 'Intermediate — flexible sleep schedule';
    },
  },
  {
    rsid: 'rs2304672',
    gene: 'PER2',
    trait: 'Sleep Timing (circadian period)',
    category: 'Body & Physiology',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C') return 'Typical circadian period';
      if (a1 === 'G' && a2 === 'G')
        return 'May have shifted circadian rhythm — associated with different sleep preferences';
      return 'One variant copy — mild chronotype influence';
    },
  },
  {
    rsid: 'rs73598374',
    gene: 'ADA (Adenosine Deaminase)',
    trait: 'Deep Sleep Quality',
    category: 'Body & Physiology',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'May have more deep/slow-wave sleep — associated with feeling more rested';
      if (a1 === 'C' && a2 === 'C') return 'Typical sleep architecture';
      return 'One copy — slightly more deep sleep tendency';
    },
  },
  {
    rsid: 'rs2937573',
    gene: 'near TENM2',
    trait: 'Misophonia (Sound Sensitivity)',
    category: 'Body & Physiology',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'Higher likelihood of misophonia — rage at chewing/clicking sounds';
      if (a1 === 'G' && a2 === 'G') return 'Lower misophonia tendency';
      return 'Some sensitivity to trigger sounds';
    },
  },
  {
    rsid: 'rs1800795',
    gene: 'IL-6 (-174G/C)',
    trait: 'Athletic Recovery & Inflammation',
    category: 'Body & Physiology',
    interpret: (a1, a2) => {
      if (a1 === 'G' && a2 === 'G')
        return 'Higher IL-6 response — stronger acute inflammatory response post-exercise. Good for adaptation but may need more recovery.';
      if (a1 === 'C' && a2 === 'C')
        return 'Lower IL-6 response — less inflammation but may be associated with slower strength gains';
      return 'Intermediate inflammatory response';
    },
  },

  // -------- Alcohol --------
  {
    rsid: 'rs671',
    gene: 'ALDH2 (*2)',
    trait: 'Alcohol Flush Reaction',
    category: 'Alcohol',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'ALDH2*2 homozygous — severe alcohol flush, nausea, rapid heartbeat. Essentially alcohol intolerant. Also increased esophageal cancer risk from drinking.';
      if (a1 === 'G' && a2 === 'G')
        return 'Normal ALDH2 — no flush reaction, typical alcohol metabolism';
      return "ALDH2*2 heterozygous — 'Asian glow' after drinking. Flushing, headache. Increased cancer risk if drinking heavily.";
    },
  },
  {
    rsid: 'rs1229984',
    gene: 'ADH1B (Arg48His)',
    trait: 'Alcohol Metabolism Speed',
    category: 'Alcohol',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Ultra-fast alcohol → acetaldehyde conversion. Alcohol feels unpleasant faster — natural deterrent. Protective against alcoholism.';
      if (a1 === 'C' && a2 === 'C')
        return 'Normal-speed alcohol metabolism (most common in European populations)';
      return 'Faster-than-average alcohol metabolism. Mild protective effect.';
    },
  },
  {
    rsid: 'rs762551',
    gene: 'CYP1A2',
    trait: 'Caffeine Metabolism Speed',
    category: 'Alcohol',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'Fast caffeine metabolizer — coffee clears your system quickly. 3pm espresso? No problem.';
      if (a1 === 'C' && a2 === 'C')
        return 'Slow caffeine metabolizer — that afternoon coffee keeps you up. Also higher heart attack risk with heavy coffee drinking.';
      return 'Moderate caffeine metabolizer';
    },
  },

  // -------- Personality & Cognition --------
  {
    rsid: 'rs4680',
    gene: 'COMT (Val158Met)',
    trait: 'Stress Response (Warrior vs Worrier)',
    category: 'Personality & Cognition',
    interpret: (a1, a2) => {
      if (a1 === 'G' && a2 === 'G')
        return "Val/Val — 'Warrior'. Faster dopamine clearance. Better under acute stress/danger but lower baseline cognitive performance. Higher pain tolerance.";
      if (a1 === 'A' && a2 === 'A')
        return "Met/Met — 'Worrier'. Slower dopamine clearance. Better baseline cognition and memory but more anxious under stress. Lower pain tolerance.";
      return 'Val/Met — Best of both worlds. Flexible stress response, good baseline cognition.';
    },
  },
  {
    rsid: 'rs6265',
    gene: 'BDNF (Val66Met)',
    trait: 'Memory & Neuroplasticity',
    category: 'Personality & Cognition',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C')
        return 'Val/Val — Normal BDNF secretion. Good hippocampal function, typical memory performance.';
      if (a1 === 'T' && a2 === 'T')
        return 'Met/Met — Reduced activity-dependent BDNF. May affect memory and stress resilience. Exercise strongly counteracts this.';
      return 'Val/Met — Mildly reduced BDNF activity. Exercise is especially beneficial for you.';
    },
  },
  {
    rsid: 'rs53576',
    gene: 'OXTR (Oxytocin Receptor)',
    trait: 'Empathy & Social Bonding',
    category: 'Personality & Cognition',
    interpret: (a1, a2) => {
      if (a1 === 'G' && a2 === 'G')
        return 'Associated with higher empathy, better social skills, and more optimistic outlook. Also more sensitive to social stress.';
      if (a1 === 'A' && a2 === 'A')
        return 'Associated with lower baseline empathy scores (but not destiny — empathy is learnable). May handle social rejection better.';
      return 'Intermediate — one of each allele';
    },
  },
  {
    rsid: 'rs1800497',
    gene: 'ANKK1/DRD2 (Taq1A)',
    trait: 'Dopamine Receptor Density',
    category: 'Personality & Cognition',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'Fewer D2 dopamine receptors. May seek more stimulation/reward. Associated with higher addiction vulnerability but also creativity.';
      if (a1 === 'G' && a2 === 'G')
        return 'Normal D2 receptor density. Typical reward sensitivity.';
      return 'Slightly reduced D2 density — moderately increased reward-seeking';
    },
  },
  {
    rsid: 'rs1800955',
    gene: 'DRD4 (-521C/T)',
    trait: 'Novelty Seeking',
    category: 'Personality & Cognition',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Lower DRD4 expression — associated with higher novelty seeking and exploration behavior';
      if (a1 === 'C' && a2 === 'C')
        return 'Higher DRD4 expression — more cautious/routine-oriented tendency';
      return 'Intermediate novelty-seeking tendency';
    },
  },

  // -------- More Appearance --------
  {
    rsid: 'rs10195570',
    gene: 'EDAR region',
    trait: 'Earlobe Attachment',
    category: 'Appearance',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A') return 'More likely to have attached (connected) earlobes';
      if (a1 === 'G' && a2 === 'G') return 'More likely to have free-hanging (detached) earlobes';
      return 'Intermediate — earlobe shape is influenced by many genes';
    },
  },
  {
    rsid: 'rs17782313',
    gene: 'MC4R',
    trait: 'Appetite & Satiety Signaling',
    category: 'Body & Physiology',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C')
        return 'Increased appetite, reduced satiety signals. May feel hungrier and less satisfied after meals. Mindful eating practices can help.';
      if (a1 === 'T' && a2 === 'T') return 'Typical appetite regulation';
      return 'Mildly increased appetite tendency';
    },
  },

  // -------- Sports & Injury Risk --------
  {
    rsid: 'rs12722',
    gene: 'COL5A1',
    trait: 'Tendon & Ligament Flexibility',
    category: 'Sports & Injury',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'More flexible tendons — greater range of motion but higher risk of Achilles tendon and other soft tissue injuries';
      if (a1 === 'C' && a2 === 'C')
        return 'Stiffer tendons — better force transfer but less flexibility. Lower soft tissue injury risk.';
      return 'Intermediate tendon properties';
    },
  },
  {
    rsid: 'rs1800012',
    gene: 'COL1A1 (Sp1)',
    trait: 'Ligament & Bone Strength',
    category: 'Sports & Injury',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Reduced collagen production — higher risk of ACL tears, fractures, and ligament injuries. Strength training is protective.';
      if (a1 === 'G' && a2 === 'G') return 'Normal collagen production — lower injury risk';
      return 'One copy — mildly increased injury risk. Prehab exercises recommended.';
    },
  },
  {
    rsid: 'rs8192678',
    gene: 'PPARGC1A (Gly482Ser)',
    trait: 'VO2 Max & Endurance Trainability',
    category: 'Sports & Injury',
    interpret: (a1, a2) => {
      if (a1 === 'G' && a2 === 'G')
        return 'Gly/Gly — higher baseline aerobic capacity and better VO2 max response to training. Favors endurance sports.';
      if (a1 === 'A' && a2 === 'A')
        return 'Ser/Ser — lower baseline aerobic capacity. Can still improve with training, just from a different starting point.';
      return 'Intermediate — good training response';
    },
  },

  // -------- Substance Sensitivity --------
  {
    rsid: 'rs5751876',
    gene: 'ADORA2A',
    trait: 'Caffeine-Induced Anxiety',
    category: 'Alcohol',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Higher sensitivity to caffeine-induced anxiety and jitteriness. Even moderate coffee may make you anxious. This is separate from metabolism speed (CYP1A2).';
      if (a1 === 'C' && a2 === 'C')
        return 'Lower anxiety response to caffeine — can drink more without jitters';
      return 'Moderate caffeine anxiety sensitivity';
    },
  },

  // -------- Nutrient Conversion --------
  {
    rsid: 'rs7501331',
    gene: 'BCMO1',
    trait: 'Beta-Carotene → Vitamin A Conversion',
    category: 'Body & Physiology',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Poor converter — carrots and sweet potatoes may NOT provide enough vitamin A for you. ~45% of people carry at least one variant. Consider preformed vitamin A (retinol from animal sources or supplements).';
      if (a1 === 'C' && a2 === 'C')
        return 'Good converter — plant-based beta-carotene sources work well for you';
      return 'Reduced conversion (~30-50% less efficient). May benefit from some preformed vitamin A.';
    },
  },
  {
    rsid: 'rs12934922',
    gene: 'BCMO1 (second marker)',
    trait: 'Beta-Carotene Conversion (confirmatory)',
    category: 'Body & Physiology',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Confirms poor beta-carotene conversion — combined with rs7501331 above, conversion may be reduced by 50-70%';
      if (a1 === 'A' && a2 === 'A') return 'Normal conversion at this position';
      return 'One copy — mildly reduced';
    },
  },
];

// ============================================================
//  SECTION 2: HEALTH SNPs
// ============================================================

export const HEALTH_SNPS: TraitSNP[] = [
  // -------- Cardiovascular & Clotting --------
  {
    rsid: 'rs6025',
    gene: 'F5 (Factor V Leiden)',
    trait: 'Blood Clotting Risk',
    category: 'Cardiovascular',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'HOMOZYGOUS Factor V Leiden — significantly increased clotting risk (~80x). Discuss with a doctor, especially before surgery, long flights, or hormonal contraceptives.';
      if (a1 === 'C' && a2 === 'C') return 'No Factor V Leiden variant — normal clotting';
      return 'HETEROZYGOUS Factor V Leiden — moderately increased clotting risk (~3-8x). Worth mentioning to your doctor.';
    },
  },
  {
    rsid: 'rs1799963',
    gene: 'F2 (Prothrombin G20210A)',
    trait: 'Prothrombin Thrombophilia',
    category: 'Cardiovascular',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'Homozygous — significantly elevated prothrombin levels and clotting risk. Discuss with a doctor.';
      if (a1 === 'G' && a2 === 'G') return 'No prothrombin variant — normal';
      return 'Heterozygous — mildly increased clotting risk (~2-3x). Worth mentioning to your doctor.';
    },
  },
  {
    rsid: 'rs1333049',
    gene: '9p21.3 (CDKN2A/2B)',
    trait: 'Coronary Heart Disease Risk',
    category: 'Cardiovascular',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C')
        return 'Higher risk genotype for coronary artery disease (~1.6x). This is one of the strongest common genetic risk factors for heart disease. Lifestyle modification helps significantly.';
      if (a1 === 'G' && a2 === 'G') return 'Lower risk genotype at this locus';
      return 'Intermediate risk (~1.3x). Heart disease is heavily lifestyle-dependent.';
    },
  },
  {
    rsid: 'rs429358',
    gene: 'APOE (part 1 of 2)',
    trait: 'APOE Status (determines e2/e3/e4)',
    category: 'Cardiovascular',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C')
        return 'C/C at rs429358 — see rs7412 below for combined APOE type';
      if (a1 === 'T' && a2 === 'T')
        return 'T/T at rs429358 — see rs7412 below for combined APOE type';
      return 'T/C at rs429358 — see rs7412 below for combined APOE type';
    },
  },
  {
    rsid: 'rs7412',
    gene: 'APOE (part 2 of 2)',
    trait: 'APOE Allele Determination',
    category: 'Cardiovascular',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T') return 'T/T at rs7412';
      if (a1 === 'C' && a2 === 'C') return 'C/C at rs7412';
      return 'C/T at rs7412';
    },
  },
  {
    rsid: 'rs693',
    gene: 'APOB',
    trait: 'LDL Cholesterol Levels',
    category: 'Cardiovascular',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A') return 'Associated with higher LDL cholesterol levels';
      if (a1 === 'G' && a2 === 'G') return 'Associated with lower LDL cholesterol';
      return 'Intermediate LDL influence';
    },
  },
  {
    rsid: 'rs1800588',
    gene: 'LIPC (-250G/A)',
    trait: 'HDL Cholesterol',
    category: 'Cardiovascular',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return "Associated with higher HDL ('good' cholesterol) — cardioprotective";
      if (a1 === 'C' && a2 === 'C') return 'Normal HDL levels at this locus';
      return 'Slightly elevated HDL';
    },
  },
  {
    rsid: 'rs662799',
    gene: 'APOA5 (-1131T/C)',
    trait: 'Triglyceride Levels',
    category: 'Cardiovascular',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C')
        return 'Associated with higher triglyceride levels. Diet and exercise have strong effects on triglycerides.';
      if (a1 === 'T' && a2 === 'T') return 'Normal triglyceride tendency at this locus';
      return 'Mildly elevated triglyceride tendency';
    },
  },

  // -------- Cancer Markers --------
  {
    rsid: 'rs1042522',
    gene: 'TP53 (R72P)',
    trait: 'TP53 Tumor Suppressor Variant',
    category: 'Cancer Markers',
    interpret: (a1, a2) => {
      if (a1 === 'G' && a2 === 'G')
        return 'Arg/Arg — more potent apoptosis. Better chemo response in some cancers but slightly different cancer susceptibility profile.';
      if (a1 === 'C' && a2 === 'C')
        return 'Pro/Pro — better cell cycle arrest and DNA repair. Different cancer risk profile.';
      return 'Arg/Pro — heterozygous, intermediate function. Very common.';
    },
  },
  {
    rsid: 'rs1799950',
    gene: 'BRCA1',
    trait: 'BRCA1 Variant Screen',
    category: 'Cancer Markers',
    interpret: (a1, a2) => {
      if (a1 === 'G' && a2 === 'G')
        return 'No variant at this position. IMPORTANT: Consumer chips test <1% of BRCA1. This is NOT a clearance. Clinical testing is the gold standard.';
      return 'Variant detected — consider genetic counseling, especially with family history of breast/ovarian cancer.';
    },
  },
  {
    rsid: 'rs1799966',
    gene: 'BRCA1 (D1692N)',
    trait: 'BRCA1 Second Position',
    category: 'Cancer Markers',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'No variant detected at this position. Same caveat: chips test very few BRCA positions.';
      if (a1 === 'G' && a2 === 'G')
        return 'Variant detected — this is a known BRCA1 missense. Discuss with genetic counselor.';
      return 'Heterozygous — one variant copy. Consider genetic counseling.';
    },
  },

  // -------- Pharmacogenomics (Drug Response) --------
  {
    rsid: 'rs4244285',
    gene: 'CYP2C19*2',
    trait: 'Clopidogrel (Plavix) Response',
    category: 'Pharmacogenomics',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'Poor metabolizer — clopidogrel (Plavix) may be INEFFECTIVE. FDA boxed warning. Alternatives exist (prasugrel, ticagrelor). Tell your doctor.';
      if (a1 === 'G' && a2 === 'G') return 'Normal metabolizer — standard clopidogrel response';
      return 'Intermediate metabolizer — reduced clopidogrel activation. Worth noting if prescribed.';
    },
  },
  {
    rsid: 'rs12248560',
    gene: 'CYP2C19*17',
    trait: 'CYP2C19 Ultra-Rapid Metabolism',
    category: 'Pharmacogenomics',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Ultra-rapid metabolizer — processes many drugs faster. May need higher doses of some medications (PPIs, antidepressants, antifungals).';
      if (a1 === 'C' && a2 === 'C') return 'Normal CYP2C19 speed at this position';
      return 'One *17 allele — increased metabolism speed for CYP2C19 substrates';
    },
  },
  {
    rsid: 'rs1065852',
    gene: 'CYP2D6',
    trait: 'Drug Metabolism (codeine, SSRIs, tamoxifen, etc.)',
    category: 'Pharmacogenomics',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return "Likely poor metabolizer — codeine won't convert to morphine (ineffective). Tamoxifen may be less effective. Some SSRIs may accumulate. Full CYP2D6 needs more SNPs + gene copy number.";
      if (a1 === 'G' && a2 === 'G') return 'Normal function at this position';
      return 'Intermediate — one reduced-function allele. May affect drug dosing.';
    },
  },
  {
    rsid: 'rs9923231',
    gene: 'VKORC1 (-1639G/A)',
    trait: 'Warfarin (Coumadin) Sensitivity',
    category: 'Pharmacogenomics',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'HIGH warfarin sensitivity — would need ~50% lower dose. Critical info if ever prescribed warfarin.';
      if (a1 === 'C' && a2 === 'C') return 'Normal warfarin sensitivity — standard dosing';
      return 'Intermediate sensitivity — may need ~25% dose reduction';
    },
  },
  {
    rsid: 'rs4149056',
    gene: 'SLCO1B1 (*5)',
    trait: 'Statin Side Effects (muscle pain)',
    category: 'Pharmacogenomics',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C')
        return 'HIGH risk of statin-induced myopathy. If on statins and having muscle pain, this may be why. Lower doses or rosuvastatin/pravastatin may help.';
      if (a1 === 'T' && a2 === 'T') return 'Normal statin transport — lower myopathy risk';
      return 'Moderate myopathy risk — worth monitoring if on simvastatin especially';
    },
  },
  {
    rsid: 'rs1799853',
    gene: 'CYP2C9*2',
    trait: 'NSAID & Warfarin Metabolism',
    category: 'Pharmacogenomics',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Poor CYP2C9 metabolizer at this position — slower clearance of ibuprofen, warfarin, some diabetes meds. May need dose adjustments.';
      if (a1 === 'C' && a2 === 'C') return 'Normal CYP2C9 metabolism';
      return 'Intermediate — one *2 allele, mildly reduced metabolism';
    },
  },
  {
    rsid: 'rs6311',
    gene: 'HTR2A (-1438G/A)',
    trait: 'SSRI Antidepressant Response',
    category: 'Pharmacogenomics',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C')
        return 'Higher serotonin receptor density — may have different SSRI response profile';
      if (a1 === 'T' && a2 === 'T')
        return 'Lower receptor density — different antidepressant response pattern';
      return 'Intermediate receptor density';
    },
  },

  // -------- Metabolic --------
  {
    rsid: 'rs7903146',
    gene: 'TCF7L2',
    trait: 'Type 2 Diabetes Risk (strongest common SNP)',
    category: 'Metabolic',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Highest risk genotype (~1.7x T2D risk). The single strongest common genetic risk factor for T2D. BUT: 30 min/day exercise reduces risk by ~60% regardless of genotype.';
      if (a1 === 'C' && a2 === 'C') return 'Lower risk genotype';
      return 'Intermediate risk (~1.3x). Lifestyle is still the dominant factor.';
    },
  },
  {
    rsid: 'rs12255372',
    gene: 'TCF7L2 (second marker)',
    trait: 'Type 2 Diabetes Risk (confirmatory)',
    category: 'Metabolic',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T') return 'Risk genotype — consistent with rs7903146 above';
      if (a1 === 'G' && a2 === 'G') return 'Lower risk';
      return 'Intermediate';
    },
  },
  {
    rsid: 'rs1801282',
    gene: 'PPARG (Pro12Ala)',
    trait: 'Insulin Sensitivity',
    category: 'Metabolic',
    interpret: (a1, a2) => {
      if (a1 === 'G' && a2 === 'G')
        return 'Pro/Pro — slightly higher T2D risk (the common genotype, ~85% of people)';
      if (a1 === 'C' && a2 === 'C') return 'Ala/Ala — improved insulin sensitivity (rare, ~1-2%)';
      return 'Pro/Ala — ~20% reduced T2D risk. Modestly protective.';
    },
  },
  {
    rsid: 'rs9939609',
    gene: 'FTO',
    trait: 'Obesity Risk & Appetite',
    category: 'Metabolic',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'Higher obesity risk (~1.7x). Associated with increased appetite and reduced satiety signals. Physical activity cuts this risk nearly in half.';
      if (a1 === 'T' && a2 === 'T') return 'Lower obesity risk at this locus';
      return 'Moderate obesity risk (~1.3x). Exercise blunts the FTO effect significantly.';
    },
  },
  {
    rsid: 'rs2943641',
    gene: 'IRS1',
    trait: 'Insulin Resistance',
    category: 'Metabolic',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Higher insulin resistance tendency. Associated with more visceral fat. Responds well to exercise intervention.';
      if (a1 === 'C' && a2 === 'C') return 'Better insulin sensitivity at this locus';
      return 'Intermediate insulin sensitivity';
    },
  },

  // -------- Folate & B-Vitamins --------
  {
    rsid: 'rs1801133',
    gene: 'MTHFR (C677T)',
    trait: 'Folate Metabolism',
    category: 'Nutrients & Vitamins',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'Reduced MTHFR activity (~30%). May benefit from methylfolate (5-MTHF) over folic acid. Ensure adequate B2, B6, B12. Common — ~10% of many populations.';
      if (a1 === 'G' && a2 === 'G') return 'Normal MTHFR enzyme activity';
      return 'Mildly reduced activity (~65%). Very common. Generally not clinically significant alone.';
    },
  },
  {
    rsid: 'rs1801131',
    gene: 'MTHFR (A1298C)',
    trait: 'Folate Metabolism (second position)',
    category: 'Nutrients & Vitamins',
    interpret: (a1, a2) => {
      if (a1 === 'G' && a2 === 'G')
        return 'Reduced activity here too. If ALSO heterozygous/homozygous for C677T above → compound effect on folate processing.';
      if (a1 === 'T' && a2 === 'T') return 'Normal activity at this position';
      return 'One copy — mild reduction, usually not significant alone';
    },
  },
  {
    rsid: 'rs2282679',
    gene: 'GC (Vitamin D Binding Protein)',
    trait: 'Vitamin D Levels',
    category: 'Nutrients & Vitamins',
    interpret: (a1, a2) => {
      if (a1 === 'G' && a2 === 'G')
        return 'Associated with lower circulating vitamin D. Supplementation likely beneficial, especially at northern latitudes or with indoor lifestyle.';
      if (a1 === 'T' && a2 === 'T') return 'Associated with higher circulating vitamin D';
      return 'Intermediate vitamin D levels';
    },
  },
  {
    rsid: 'rs12785878',
    gene: 'DHCR7/NADSYN1',
    trait: 'Vitamin D Synthesis',
    category: 'Nutrients & Vitamins',
    interpret: (a1, a2) => {
      if (a1 === 'G' && a2 === 'G')
        return 'Reduced vitamin D synthesis from sunlight. Combined with GC variant above, may especially benefit from supplementation.';
      if (a1 === 'T' && a2 === 'T') return 'Normal vitamin D synthesis';
      return 'Slightly reduced vitamin D synthesis';
    },
  },
  {
    rsid: 'rs855791',
    gene: 'TMPRSS6',
    trait: 'Iron Levels',
    category: 'Nutrients & Vitamins',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'Associated with lower iron/ferritin. May be more prone to iron deficiency, especially with heavy exercise or menstruation.';
      if (a1 === 'G' && a2 === 'G') return 'Associated with higher iron levels';
      return 'Intermediate iron metabolism';
    },
  },
  {
    rsid: 'rs1800562',
    gene: 'HFE (C282Y)',
    trait: 'Hereditary Hemochromatosis (Iron Overload)',
    category: 'Nutrients & Vitamins',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'HOMOZYGOUS C282Y — high risk for iron overload. Get serum ferritin tested. Highly treatable with regular blood donation/phlebotomy. Early detection prevents organ damage.';
      if (a1 === 'G' && a2 === 'G') return 'No C282Y — normal iron regulation at this locus';
      return 'CARRIER — one copy. Low risk alone, but if also carrying H63D (rs1799945), check ferritin periodically.';
    },
  },
  {
    rsid: 'rs1799945',
    gene: 'HFE (H63D)',
    trait: 'Hemochromatosis (second marker)',
    category: 'Nutrients & Vitamins',
    interpret: (a1, a2) => {
      if (a1 === 'G' && a2 === 'G')
        return 'H63D homozygous — mild iron overload risk. If also C282Y carrier → compound heterozygous, moderate risk.';
      if (a1 === 'C' && a2 === 'C') return 'No H63D variant';
      return 'H63D carrier. Low risk alone. Check if combined with C282Y above.';
    },
  },
  {
    rsid: 'rs174547',
    gene: 'FADS1',
    trait: 'Omega-3 Fatty Acid Metabolism',
    category: 'Nutrients & Vitamins',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Less efficient ALA → EPA/DHA conversion. Plant omega-3s (flax, chia) may not be enough — consider fish oil or algae DHA directly.';
      if (a1 === 'C' && a2 === 'C')
        return 'More efficient omega-3 conversion. Plant sources may be adequate.';
      return 'Moderate conversion efficiency. Fish/algae omega-3 still beneficial.';
    },
  },
  {
    rsid: 'rs601338',
    gene: 'FUT2 (Secretor Status)',
    trait: 'B12 Absorption & Gut Microbiome',
    category: 'Nutrients & Vitamins',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'Non-secretor — may have lower B12 levels and different gut microbiome composition. Also see Immunity section (norovirus resistance).';
      if (a1 === 'G' && a2 === 'G')
        return 'Secretor — normal B12 absorption, typical gut microbiome profile';
      return 'One copy — secretor (G is dominant). Normal B12 absorption.';
    },
  },

  // -------- Immunity & Disease Resistance --------
  {
    rsid: 'rs601338',
    gene: 'FUT2 (Secretor Status)',
    trait: 'Norovirus Resistance',
    category: 'Immunity & Resistance',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return "NON-SECRETOR — naturally resistant to most norovirus strains! (~20% of Europeans). The 'stomach flu' that hits everyone else may skip you entirely.";
      if (a1 === 'G' && a2 === 'G') return 'Secretor — susceptible to norovirus (like most people)';
      return 'Secretor (G dominant) — susceptible to norovirus';
    },
  },
  {
    rsid: 'rs334',
    gene: 'HBB (Sickle Cell)',
    trait: 'Sickle Cell Trait / Malaria Resistance',
    category: 'Immunity & Resistance',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'SICKLE CELL DISEASE (homozygous HbS). If this is unexpected, verify with clinical testing — consumer chips can have errors at this locus.';
      if (a1 === 'T' && a2 === 'T') return 'Normal hemoglobin — no sickle cell trait';
      return 'SICKLE CELL TRAIT (carrier) — one copy of HbS. Generally healthy but confers partial malaria resistance. Important for family planning.';
    },
  },
  {
    rsid: 'rs2814778',
    gene: 'DARC/ACKR1 (Duffy Antigen)',
    trait: 'Malaria Resistance (P. vivax)',
    category: 'Immunity & Resistance',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C')
        return 'Duffy-negative — resistant to P. vivax malaria. Nearly universal in West African populations. The red blood cells lack the receptor the parasite uses to enter.';
      if (a1 === 'T' && a2 === 'T') return 'Duffy-positive — susceptible to P. vivax malaria';
      return 'One copy — partial resistance';
    },
  },
  {
    rsid: 'rs12979860',
    gene: 'IFNL3/IL28B',
    trait: 'Hepatitis C Natural Clearance',
    category: 'Immunity & Resistance',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C')
        return 'If exposed to Hep C, higher chance (~50%) of natural clearance without treatment. Also better response to interferon therapy.';
      if (a1 === 'T' && a2 === 'T')
        return 'Lower chance of natural Hep C clearance (~20%). Modern DAA treatments work regardless of this genotype.';
      return 'Intermediate clearance probability (~30-40%)';
    },
  },
  {
    rsid: 'rs2187668',
    gene: 'HLA-DQ2.5',
    trait: 'Celiac Disease Risk',
    category: 'Immunity & Resistance',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Homozygous HLA-DQ2.5 — highest genetic predisposition for celiac. But ~95% of DQ2 carriers never develop celiac. If you have GI symptoms, worth testing.';
      if (a1 === 'C' && a2 === 'C')
        return 'No HLA-DQ2.5 — celiac disease very unlikely (but DQ8 can also confer risk)';
      return 'One copy — celiac possible. Only ~3% of carriers develop it.';
    },
  },

  // -------- Inflammation & Autoimmune --------
  {
    rsid: 'rs1800629',
    gene: 'TNF-alpha (-308G/A)',
    trait: 'Baseline Inflammatory Response',
    category: 'Inflammation & Autoimmune',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'Higher TNF-alpha production — stronger inflammatory response. Associated with autoimmune conditions. Anti-inflammatory diet/lifestyle may be especially beneficial.';
      if (a1 === 'G' && a2 === 'G') return 'Normal TNF-alpha production';
      return 'Mildly increased TNF-alpha — one pro-inflammatory allele';
    },
  },
  {
    rsid: 'rs1800896',
    gene: 'IL-10 (-1082G/A)',
    trait: 'Anti-Inflammatory Capacity',
    category: 'Inflammation & Autoimmune',
    interpret: (a1, a2) => {
      if (a1 === 'G' && a2 === 'G')
        return 'Higher IL-10 (anti-inflammatory cytokine) — better at resolving inflammation';
      if (a1 === 'A' && a2 === 'A')
        return 'Lower IL-10 production — may have more persistent inflammatory responses';
      return 'Intermediate anti-inflammatory capacity';
    },
  },
  {
    rsid: 'rs2476601',
    gene: 'PTPN22 (R620W)',
    trait: 'Autoimmune Disease Risk (multi-disease)',
    category: 'Inflammation & Autoimmune',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'Homozygous variant — significantly increased risk for RA, Type 1 diabetes, lupus, thyroid disease. One of the strongest autoimmune risk SNPs.';
      if (a1 === 'G' && a2 === 'G') return 'No variant — normal immune regulation at this locus';
      return 'One copy — modestly increased autoimmune risk (~1.5-2x for RA, T1D, etc.)';
    },
  },
  {
    rsid: 'rs3135388',
    gene: 'HLA-DRB1*15:01 (tag SNP)',
    trait: 'Multiple Sclerosis Risk',
    category: 'Inflammation & Autoimmune',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'Homozygous — highest genetic risk for MS at this locus (~6x). MS is still rare overall (~0.1% prevalence).';
      if (a1 === 'G' && a2 === 'G') return 'No HLA-DRB1*15:01 — lower MS risk';
      return 'One copy — moderately increased MS risk (~3x). Still low absolute risk.';
    },
  },

  // -------- Eye Health --------
  {
    rsid: 'rs1061170',
    gene: 'CFH (Y402H)',
    trait: 'Age-Related Macular Degeneration (AMD)',
    category: 'Eye Health',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C')
        return 'Higher AMD risk (~6x). The single strongest genetic risk factor for macular degeneration. Omega-3s, lutein/zeaxanthin, not smoking, and UV protection are protective.';
      if (a1 === 'T' && a2 === 'T') return 'Lower AMD risk at this locus';
      return 'Moderate AMD risk (~2.5x). Eye nutrition and UV protection recommended.';
    },
  },
  {
    rsid: 'rs10490924',
    gene: 'ARMS2/HTRA1',
    trait: 'Macular Degeneration (second locus)',
    category: 'Eye Health',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Higher AMD risk at this independent locus. Combined with CFH above, risk can be substantially elevated.';
      if (a1 === 'G' && a2 === 'G') return 'Lower risk at this position';
      return 'Moderate risk — one copy';
    },
  },
  {
    rsid: 'rs524952',
    gene: 'GJD2',
    trait: 'Myopia (Nearsightedness) Risk',
    category: 'Eye Health',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'Higher genetic tendency toward myopia. Time outdoors during childhood is strongly protective regardless of genetics.';
      if (a1 === 'G' && a2 === 'G') return 'Lower myopia tendency at this locus';
      return 'Moderate myopia tendency';
    },
  },

  // -------- Digestive --------
  {
    rsid: 'rs2231142',
    gene: 'ABCG2 (Q141K)',
    trait: 'Gout Risk (Uric Acid Transport)',
    category: 'Digestive & Metabolic',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Significantly reduced uric acid excretion — higher gout risk (~2-3x). Hydration, limiting purine-rich foods (red meat, shellfish, beer) helps.';
      if (a1 === 'G' && a2 === 'G') return 'Normal uric acid transport — lower gout risk';
      return 'Moderately reduced uric acid excretion — some gout risk';
    },
  },
  {
    rsid: 'rs11942223',
    gene: 'SLC2A9',
    trait: 'Uric Acid Levels',
    category: 'Digestive & Metabolic',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Associated with higher serum uric acid. Combined with ABCG2 above, gout risk may be substantial.';
      if (a1 === 'C' && a2 === 'C') return 'Associated with lower uric acid levels — protective';
      return 'Intermediate uric acid levels';
    },
  },
  {
    rsid: 'rs11887534',
    gene: 'ABCG8 (D19H)',
    trait: 'Gallstone Risk',
    category: 'Digestive & Metabolic',
    interpret: (a1, a2) => {
      if (a1 === 'G' && a2 === 'G')
        return 'Significantly increased gallstone risk (~2-3x). The strongest common genetic risk factor for cholesterol gallstones.';
      if (a1 === 'C' && a2 === 'C') return 'Normal cholesterol secretion — lower gallstone risk';
      return 'Moderately increased gallstone risk';
    },
  },
  {
    rsid: 'rs11209026',
    gene: 'IL23R (R381Q)',
    trait: "Crohn's Disease / IBD Protection",
    category: 'Digestive & Metabolic',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return "Strongly protective against Crohn's disease and ulcerative colitis (rare genotype)";
      if (a1 === 'G' && a2 === 'G') return 'No protective variant — normal IBD risk';
      return "One protective copy — modestly reduced IBD/Crohn's risk";
    },
  },
  {
    rsid: 'rs219780',
    gene: 'CLDN14',
    trait: 'Kidney Stone Risk',
    category: 'Digestive & Metabolic',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Higher kidney stone risk. Stay well-hydrated, moderate oxalate intake (spinach, nuts), ensure adequate calcium.';
      if (a1 === 'C' && a2 === 'C') return 'Lower kidney stone risk at this locus';
      return 'Moderate risk — hydration is key';
    },
  },

  // -------- Skin Conditions --------
  {
    rsid: 'rs10484554',
    gene: 'HLA-C*06:02',
    trait: 'Psoriasis Risk',
    category: 'Skin Conditions',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Significantly higher psoriasis risk (~5-9x). HLA-C*06:02 is the strongest genetic risk factor. Stress management and avoiding triggers helps.';
      if (a1 === 'C' && a2 === 'C') return 'Lower psoriasis risk at this locus';
      return 'Moderately increased psoriasis risk (~2-3x)';
    },
  },
  {
    rsid: 'rs1015362',
    gene: 'ASIP (Agouti)',
    trait: 'Melanoma Risk',
    category: 'Skin Conditions',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Higher melanoma risk — associated with pigmentation patterns. Sun protection (SPF, avoiding burns) is critical.';
      if (a1 === 'C' && a2 === 'C') return 'Lower melanoma risk at this locus';
      return 'Moderate melanoma risk — sun protection recommended';
    },
  },

  // -------- Neurological --------
  {
    rsid: 'rs3923809',
    gene: 'BTBD9',
    trait: 'Restless Leg Syndrome',
    category: 'Neurological',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'Higher risk for restless leg syndrome (~1.5x). Iron supplementation may help if ferritin is low. Exercise and avoiding caffeine before bed can reduce symptoms.';
      if (a1 === 'G' && a2 === 'G') return 'Lower RLS risk at this locus';
      return 'Moderate RLS risk';
    },
  },
  {
    rsid: 'rs2651899',
    gene: 'PRDM16',
    trait: 'Migraine Susceptibility',
    category: 'Neurological',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C')
        return 'Higher migraine susceptibility. Identifying personal triggers (sleep, stress, foods, hormones) is the best management strategy.';
      if (a1 === 'T' && a2 === 'T') return 'Lower migraine susceptibility at this locus';
      return 'Moderate migraine tendency';
    },
  },
  {
    rsid: 'rs10166942',
    gene: 'TRPM8',
    trait: 'Migraine (cold-sensor pathway)',
    category: 'Neurological',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Higher migraine risk via cold-sensitive ion channel. Interestingly, this is the same receptor that makes menthol feel cold.';
      if (a1 === 'C' && a2 === 'C') return 'Lower migraine risk at this position';
      return 'Moderate risk — one copy';
    },
  },

  // -------- Respiratory --------
  {
    rsid: 'rs28929474',
    gene: 'SERPINA1 (Z allele)',
    trait: 'Alpha-1 Antitrypsin Deficiency',
    category: 'Respiratory',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'HOMOZYGOUS Z allele — Alpha-1 Antitrypsin Deficiency (A1AD). Significantly increased risk of early-onset emphysema and liver disease. Treatable with augmentation therapy. Get tested if not already diagnosed.';
      if (a1 === 'C' && a2 === 'C') return 'No Z allele — normal alpha-1 antitrypsin levels';
      return 'CARRIER (MZ) — mildly reduced A1AT levels (~60%). Avoid smoking (critical). Low risk of disease but get baseline liver function checked.';
    },
  },

  // -------- More Cardiovascular --------
  {
    rsid: 'rs699',
    gene: 'AGT (M235T)',
    trait: 'Salt-Sensitive Blood Pressure',
    category: 'Cardiovascular',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C')
        return 'Higher angiotensinogen levels — blood pressure more sensitive to salt intake. Reducing sodium intake may be especially beneficial for you.';
      if (a1 === 'T' && a2 === 'T')
        return 'Lower salt sensitivity — blood pressure less affected by sodium';
      return 'Moderate salt sensitivity';
    },
  },

  // -------- More Cancer --------
  {
    rsid: 'rs6983267',
    gene: '8q24',
    trait: 'Prostate & Colorectal Cancer Risk',
    category: 'Cancer Markers',
    interpret: (a1, a2) => {
      if (a1 === 'G' && a2 === 'G')
        return 'Higher risk for both prostate cancer (~1.3x) and colorectal cancer (~1.2x). One of the most replicated cancer GWAS hits. Screening at recommended ages is important.';
      if (a1 === 'T' && a2 === 'T') return 'Lower risk at this locus';
      return 'Intermediate risk';
    },
  },
  {
    rsid: 'rs4939827',
    gene: 'SMAD7',
    trait: 'Colorectal Cancer Risk',
    category: 'Cancer Markers',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Higher colorectal cancer risk (~1.4x). Fiber intake, physical activity, limiting processed meat, and screening colonoscopy are all protective.';
      if (a1 === 'C' && a2 === 'C') return 'Lower risk at this locus';
      return 'Moderate risk — one copy';
    },
  },

  // -------- More Pharmacogenomics --------
  {
    rsid: 'rs1801272',
    gene: 'CYP2A6*2',
    trait: 'Nicotine Metabolism',
    category: 'Pharmacogenomics',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Slow nicotine metabolizer — if a smoker, may smoke fewer cigarettes but find it harder to quit. Nicotine patches may last longer.';
      if (a1 === 'A' && a2 === 'A') return 'Normal nicotine metabolism speed';
      return 'Intermediate — one slow allele';
    },
  },
  {
    rsid: 'rs628031',
    gene: 'SLC22A1 (OCT1)',
    trait: 'Metformin Response',
    category: 'Pharmacogenomics',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'Reduced metformin uptake into liver — may have lower glucose-lowering response. Higher doses or alternative medications may be needed.';
      if (a1 === 'G' && a2 === 'G')
        return 'Normal metformin transport — expected standard response';
      return 'Intermediate metformin response';
    },
  },

  // -------- More Nutrients --------
  {
    rsid: 'rs33972313',
    gene: 'SLC23A1',
    trait: 'Vitamin C Levels',
    category: 'Nutrients & Vitamins',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Reduced vitamin C transport — lower circulating levels despite adequate intake. May benefit from higher dietary vitamin C or supplementation.';
      if (a1 === 'C' && a2 === 'C') return 'Normal vitamin C transport';
      return 'Mildly reduced vitamin C levels';
    },
  },

  // -------- Atrial Fibrillation --------
  {
    rsid: 'rs2200733',
    gene: 'PITX2 (4q25)',
    trait: 'Atrial Fibrillation Risk',
    category: 'Cardiovascular',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Higher atrial fibrillation risk (~1.7x). The strongest common genetic risk factor for AFib. Watch for irregular heartbeat, especially with age.';
      if (a1 === 'C' && a2 === 'C') return 'Lower AFib risk at this locus';
      return 'Moderate AFib risk (~1.3x)';
    },
  },

  // -------- Thyroid --------
  {
    rsid: 'rs225014',
    gene: 'DIO2 (Thr92Ala)',
    trait: 'Thyroid Hormone Conversion (T4 → T3)',
    category: 'Thyroid',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Ala/Ala — reduced T4→T3 conversion. If on levothyroxine (Synthroid) and still symptomatic, may benefit from combination T4+T3 therapy. Discuss with endocrinologist.';
      if (a1 === 'C' && a2 === 'C') return 'Thr/Thr — normal T4→T3 conversion';
      return 'One copy — mildly reduced conversion. Usually not clinically significant unless on thyroid meds.';
    },
  },
  {
    rsid: 'rs965513',
    gene: 'FOXE1 (9q22)',
    trait: 'Thyroid Cancer Risk',
    category: 'Thyroid',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'Higher thyroid cancer risk (~1.7x). Thyroid cancer is generally very treatable with high survival rates.';
      if (a1 === 'G' && a2 === 'G') return 'Lower risk at this locus';
      return 'Moderate risk (~1.3x)';
    },
  },

  // -------- COVID / Viral Response --------
  {
    rsid: 'rs10774671',
    gene: 'OAS1',
    trait: 'COVID-19 Severity / Antiviral Response',
    category: 'Immunity & Resistance',
    interpret: (a1, a2) => {
      if (a1 === 'G' && a2 === 'G')
        return 'Better OAS1 antiviral activity — associated with milder COVID outcomes and better innate immune response to many viruses';
      if (a1 === 'A' && a2 === 'A')
        return 'Reduced OAS1 activity — associated with more severe COVID outcomes in multiple studies';
      return 'Intermediate antiviral response';
    },
  },

  // -------- More Autoimmune --------
  {
    rsid: 'rs4349859',
    gene: 'HLA-B27 (tag SNP)',
    trait: 'Ankylosing Spondylitis Risk',
    category: 'Inflammation & Autoimmune',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'Likely HLA-B27 positive — significantly increased risk for ankylosing spondylitis (inflammatory back disease), ~5-20% of B27+ develop AS. Also reactive arthritis risk.';
      if (a1 === 'G' && a2 === 'G') return 'Likely HLA-B27 negative — low AS risk';
      return 'One copy — may be HLA-B27 positive. If you have chronic lower back pain/stiffness (worse in morning, better with exercise), mention HLA-B27 to your doctor.';
    },
  },
  {
    rsid: 'rs7574865',
    gene: 'STAT4',
    trait: 'Lupus & Rheumatoid Arthritis Risk',
    category: 'Inflammation & Autoimmune',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Higher risk for systemic lupus (~2x) and rheumatoid arthritis (~1.3x). One of the strongest non-HLA autoimmune risk SNPs.';
      if (a1 === 'G' && a2 === 'G') return 'Lower autoimmune risk at this locus';
      return 'Moderate autoimmune risk — one copy';
    },
  },
  {
    rsid: 'rs231775',
    gene: 'CTLA4 (+49A/G)',
    trait: "Autoimmune Thyroid (Hashimoto's / Graves)",
    category: 'Inflammation & Autoimmune',
    interpret: (a1, a2) => {
      if (a1 === 'G' && a2 === 'G')
        return "Higher risk for autoimmune thyroid disease (Hashimoto's, Graves). Also modestly increased risk for T1D and other autoimmune conditions. If fatigued, check TSH.";
      if (a1 === 'A' && a2 === 'A') return 'Lower autoimmune thyroid risk at this locus';
      return 'One copy — mildly increased risk';
    },
  },
  {
    rsid: 'rs3129934',
    gene: 'HLA-DQB1*06:02 (tag SNP)',
    trait: 'Narcolepsy Risk',
    category: 'Neurological',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'Likely HLA-DQB1*06:02 positive — present in ~98% of narcolepsy type 1 patients. BUT also carried by ~25% of the general population (most never develop narcolepsy). Necessary but not sufficient.';
      if (a1 === 'G' && a2 === 'G') return 'Likely negative — narcolepsy type 1 very unlikely';
      return 'One copy — carrier status. If you have excessive daytime sleepiness or cataplexy, worth mentioning.';
    },
  },

  // -------- More Alzheimer's --------
  {
    rsid: 'rs11136000',
    gene: 'CLU (Clusterin)',
    trait: "Alzheimer's Risk (additional locus)",
    category: 'Neurological',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return "Slightly increased Alzheimer's risk at this locus (~1.15x). Small effect compared to APOE but adds up with other risk variants.";
      if (a1 === 'C' && a2 === 'C') return 'Protective variant at CLU — slightly lower risk';
      return 'Intermediate';
    },
  },
  {
    rsid: 'rs6656401',
    gene: 'CR1',
    trait: "Alzheimer's Risk (complement system)",
    category: 'Neurological',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return "Higher Alzheimer's risk via complement/immune pathway (~1.2x). Separate mechanism from APOE.";
      if (a1 === 'G' && a2 === 'G') return 'Lower risk at this locus';
      return 'One copy — modest risk increase';
    },
  },

  // -------- Parkinson's --------
  {
    rsid: 'rs34637584',
    gene: 'LRRK2 (G2019S)',
    trait: "Parkinson's Disease Risk",
    category: 'Neurological',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return "HOMOZYGOUS G2019S — very high Parkinson's risk (~75% lifetime). This is RARE. Consider clinical confirmation.";
      if (a1 === 'G' && a2 === 'G') return 'No G2019S variant — most common genotype';
      return "HETEROZYGOUS G2019S — significantly increased Parkinson's risk (~30-75% lifetime depending on ancestry). The most common genetic cause of Parkinson's. Discuss with neurologist.";
    },
  },

  // -------- Substance Response --------
  {
    rsid: 'rs279858',
    gene: 'GABRA2',
    trait: 'Alcohol Dependence Risk',
    category: 'Substance Response',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'Associated with higher alcohol dependence risk. The GABA-A receptor affects how alcohol feels rewarding. Awareness + environment matter more than genetics here.';
      if (a1 === 'G' && a2 === 'G')
        return 'Lower genetic risk for alcohol dependence at this locus';
      return 'Moderate risk — one copy';
    },
  },
  {
    rsid: 'rs2494732',
    gene: 'AKT1',
    trait: 'Cannabis Psychosis Sensitivity',
    category: 'Substance Response',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C')
        return 'Higher risk of psychotic symptoms from cannabis use (~2x). If you use cannabis and experience paranoia, anxiety, or perceptual disturbances, this may be why.';
      if (a1 === 'T' && a2 === 'T') return 'Lower cannabis psychosis risk at this locus';
      return 'Moderate sensitivity — one copy';
    },
  },

  // -------- Skin / Connective Tissue --------
  {
    rsid: 'rs7787362',
    gene: 'ELN (Elastin)',
    trait: 'Stretch Mark Susceptibility',
    category: 'Skin Conditions',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'Higher stretch mark susceptibility — reduced elastin integrity. Common with rapid growth, pregnancy, or weight changes.';
      if (a1 === 'G' && a2 === 'G') return 'More resilient elastin — lower stretch mark tendency';
      return 'Moderate susceptibility';
    },
  },

  // -------- Bone & Aging --------
  {
    rsid: 'rs2234693',
    gene: 'ESR1 (Estrogen Receptor alpha)',
    trait: 'Bone Mineral Density',
    category: 'Bone & Aging',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Associated with lower bone mineral density — higher osteoporosis risk, especially post-menopause. Weight-bearing exercise, calcium, and vitamin D are protective.';
      if (a1 === 'C' && a2 === 'C') return 'Associated with higher bone density';
      return 'Intermediate bone density';
    },
  },
  {
    rsid: 'rs2736100',
    gene: 'TERT',
    trait: 'Telomere Length',
    category: 'Bone & Aging',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C')
        return 'Associated with longer telomeres — a marker of cellular aging. Linked to longevity but also slightly higher cancer risk (cells live longer).';
      if (a1 === 'A' && a2 === 'A')
        return 'Associated with shorter telomeres. Exercise, stress management, and good sleep are all associated with maintaining telomere length.';
      return 'Intermediate telomere length';
    },
  },

  // -------- Longevity --------
  {
    rsid: 'rs2802292',
    gene: 'FOXO3',
    trait: 'Longevity',
    category: 'Longevity',
    interpret: (a1, a2) => {
      if (a1 === 'G' && a2 === 'G')
        return 'Longevity-associated genotype! Enriched in centenarians across multiple populations. Associated with better stress resistance, insulin sensitivity, and cardiovascular health.';
      if (a1 === 'T' && a2 === 'T')
        return 'Common genotype — longevity depends on many factors beyond one SNP';
      return 'One longevity allele — modest positive association';
    },
  },
  {
    rsid: 'rs2542052',
    gene: 'CETP',
    trait: 'Longevity & HDL Cholesterol',
    category: 'Longevity',
    interpret: (a1, a2) => {
      if (a1 === 'C' && a2 === 'C')
        return 'Associated with higher HDL, larger lipoprotein particle size, and longevity in Ashkenazi Jewish centenarian studies';
      if (a1 === 'T' && a2 === 'T') return 'Common genotype — typical CETP activity';
      return 'One copy — slightly favorable lipid profile';
    },
  },
];

// ============================================================
//  SECTION 3: EXPERIMENTAL (low confidence, heavily polygenic)
//  These are real GWAS hits but individual effects are tiny.
//  Showing one SNP for a polygenic condition is like judging
//  a symphony by one note. Included for completeness only.
// ============================================================

export const EXPERIMENTAL_SNPS: TraitSNP[] = [
  // -------- Psychiatric (extremely polygenic) --------
  {
    rsid: 'rs1006737',
    gene: 'CACNA1C',
    trait: 'Bipolar Disorder / Schizophrenia Cross-Risk',
    category: 'Psychiatric (Polygenic)',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'Risk allele — one of the best-replicated psychiatric GWAS hits. BUT: effect size is tiny (~1.1x). Bipolar involves 100s of genes + environment. This SNP alone is nearly meaningless.';
      if (a1 === 'G' && a2 === 'G') return 'Non-risk genotype at this locus';
      return 'One copy — negligible individual effect';
    },
  },
  {
    rsid: 'rs10994359',
    gene: 'ANK3 (Ankyrin-G)',
    trait: 'Bipolar Disorder Risk',
    category: 'Psychiatric (Polygenic)',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'Associated with bipolar (~1.1x). ANK3 is involved in neuronal signaling. One of many contributing loci.';
      if (a1 === 'G' && a2 === 'G') return 'Non-risk at this position';
      return 'One copy — minimal individual effect';
    },
  },
  {
    rsid: 'rs1344706',
    gene: 'ZNF804A',
    trait: 'Schizophrenia Risk',
    category: 'Psychiatric (Polygenic)',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return 'Risk allele for schizophrenia (~1.1x). The first genome-wide significant schizophrenia SNP ever found. Affects brain connectivity. But schizophrenia involves 200+ loci.';
      if (a1 === 'C' && a2 === 'C') return 'Non-risk genotype';
      return 'One copy — tiny effect size';
    },
  },
  {
    rsid: 'rs1360780',
    gene: 'FKBP5',
    trait: 'PTSD / Stress-Related Depression',
    category: 'Psychiatric (Polygenic)',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Altered cortisol stress response — higher PTSD risk AFTER trauma exposure. Epigenetic changes at this gene are one of the best-studied gene×environment interactions. Does NOT predict PTSD without trauma.';
      if (a1 === 'C' && a2 === 'C') return 'Typical cortisol regulation at this locus';
      return 'One copy — mildly altered stress response';
    },
  },
  {
    rsid: 'rs4570625',
    gene: 'TPH2',
    trait: 'Serotonin Synthesis / Depression Risk',
    category: 'Psychiatric (Polygenic)',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return 'Altered TPH2 (brain serotonin synthesis). Associated with emotional processing differences and amygdala reactivity. Depression link is weak and inconsistent.';
      if (a1 === 'G' && a2 === 'G') return 'Typical serotonin synthesis at this locus';
      return 'One copy — subtle effect on emotional processing';
    },
  },
  {
    rsid: 'rs1800544',
    gene: 'ADRA2A (alpha-2 adrenergic receptor)',
    trait: 'ADHD / Attention Regulation',
    category: 'Psychiatric (Polygenic)',
    interpret: (a1, a2) => {
      if (a1 === 'G' && a2 === 'G')
        return 'Associated with ADHD symptoms in some studies. This receptor is the target of ADHD medications (guanfacine). Effect is small and not consistently replicated.';
      if (a1 === 'C' && a2 === 'C') return 'Non-risk genotype';
      return 'One copy — minimal predictive value alone';
    },
  },
  {
    rsid: 'rs4916723',
    gene: 'near LINC00461',
    trait: 'ADHD Risk (largest GWAS hit)',
    category: 'Psychiatric (Polygenic)',
    interpret: (a1, a2) => {
      if (a1 === 'A' && a2 === 'A')
        return "Largest-effect ADHD GWAS SNP — but that 'largest effect' is only ~1.08x risk. ADHD is among the most polygenic conditions known. This tells you almost nothing individually.";
      if (a1 === 'C' && a2 === 'C') return 'Non-risk genotype';
      return 'One copy — statistically significant in 50,000+ people, meaningless for an individual';
    },
  },

  // -------- Rare Mendelian (chips miss most variants) --------
  {
    rsid: 'rs113993960',
    gene: 'CFTR (F508del region)',
    trait: 'Cystic Fibrosis Carrier Screen',
    category: 'Rare Mendelian (Low Chip Coverage)',
    interpret: (a1, a2) => {
      // This may show as a deletion or missing data on many chips
      if (a1 === 'T' && a2 === 'T')
        return 'No F508del detected. BUT: Consumer chips only test 1 of 2000+ known CF mutations. A negative does NOT rule out carrier status. Clinical carrier screening is recommended if planning a family.';
      return 'Possible F508del variant detected — F508del causes ~70% of CF cases. Consider clinical carrier testing to confirm.';
    },
  },
  {
    rsid: 'rs76763715',
    gene: 'GBA (N370S)',
    trait: "Gaucher's Disease Carrier / Parkinson's Modifier",
    category: 'Rare Mendelian (Low Chip Coverage)',
    interpret: (a1, a2) => {
      if (a1 === 'T' && a2 === 'T')
        return "Homozygous N370S — consistent with Gaucher's disease type 1 (if not already known). Also ~5x increased Parkinson's risk.";
      if (a1 === 'C' && a2 === 'C') return 'No N370S variant detected';
      return "CARRIER for Gaucher's disease. Generally healthy. Also carries ~2-3x increased Parkinson's risk via GBA pathway (lipid metabolism in neurons).";
    },
  },
  {
    rsid: 'rs80338939',
    gene: 'GJB2 (35delG region)',
    trait: 'Hereditary Hearing Loss Carrier',
    category: 'Rare Mendelian (Low Chip Coverage)',
    interpret: (a1, a2) => {
      if (a1 !== a2)
        return 'Possible carrier for GJB2-related hearing loss — the most common cause of hereditary deafness. Important for family planning. Consumer chip coverage is unreliable here.';
      return 'No variant detected at this position. Chip coverage of GJB2 deletions is poor — clinical testing recommended if relevant.';
    },
  },
];

// ============================================================
//  Polygenic Score Combinations
//  These combine multiple SNPs for a more meaningful signal.
// ============================================================

export interface PolygenicScore {
  name: string;
  description: string;
  snps: { rsid: string; riskAllele: string; weight: number }[];
  interpret: (score: number, max: number, found: number) => string;
}

export const POLYGENIC_SCORES: PolygenicScore[] = [
  {
    name: 'Eye Color Prediction',
    description: 'Combines 4 SNPs for better eye color prediction (IrisPlex-lite)',
    snps: [
      { rsid: 'rs12913832', riskAllele: 'G', weight: 3 }, // HERC2 — strongest
      { rsid: 'rs1800407', riskAllele: 'T', weight: 2 }, // OCA2
      { rsid: 'rs7495174', riskAllele: 'A', weight: 1 }, // OCA2
      { rsid: 'rs1393350', riskAllele: 'A', weight: 1 }, // TYR
    ],
    interpret: (score, max, found) => {
      if (found < 2) return 'Insufficient data — need at least 2 of 4 SNPs';
      const pct = score / max;
      if (pct >= 0.7) return 'Strong prediction: BLUE eyes';
      if (pct >= 0.4) return 'Prediction: GREEN or HAZEL eyes';
      if (pct >= 0.2) return 'Prediction: HAZEL or LIGHT BROWN eyes';
      return 'Strong prediction: BROWN eyes';
    },
  },
  {
    name: 'Red Hair Likelihood',
    description: 'Combines MC1R variants (need 2+ for red hair)',
    snps: [
      { rsid: 'rs1805007', riskAllele: 'T', weight: 2 }, // R151C — strong
      { rsid: 'rs1805008', riskAllele: 'T', weight: 2 }, // R160W — strong
      { rsid: 'rs1805009', riskAllele: 'A', weight: 2 }, // D294H — strong
    ],
    interpret: (score, max, found) => {
      if (found < 2) return 'Insufficient MC1R data';
      if (score >= 4) return 'Very likely RED or AUBURN hair (two strong MC1R variants)';
      if (score >= 2)
        return 'Possible reddish tints, freckling, or auburn highlights (one strong variant)';
      if (score >= 1) return 'Carrier — unlikely red hair but may have subtle reddish tones';
      return 'No MC1R red hair variants detected — red hair unlikely';
    },
  },
  {
    name: 'Type 2 Diabetes Genetic Risk',
    description: 'Combines top T2D SNPs for aggregate risk picture',
    snps: [
      { rsid: 'rs7903146', riskAllele: 'T', weight: 3 }, // TCF7L2 — strongest
      { rsid: 'rs12255372', riskAllele: 'T', weight: 2 }, // TCF7L2
      { rsid: 'rs1801282', riskAllele: 'G', weight: 1 }, // PPARG (risk is common allele)
      { rsid: 'rs9939609', riskAllele: 'A', weight: 2 }, // FTO
      { rsid: 'rs2943641', riskAllele: 'T', weight: 1 }, // IRS1
    ],
    interpret: (score, max, found) => {
      if (found < 3) return 'Insufficient data — need 3+ SNPs for meaningful estimate';
      const pct = score / max;
      if (pct >= 0.6)
        return 'ABOVE AVERAGE genetic T2D risk. But lifestyle dominates: 30 min daily exercise reduces risk ~60% regardless of genetics.';
      if (pct >= 0.3) return 'AVERAGE genetic T2D risk. Standard lifestyle recommendations apply.';
      return 'BELOW AVERAGE genetic T2D risk. You still benefit from healthy habits, but genetics are in your favor.';
    },
  },
  {
    name: 'Blood Clotting Risk Profile',
    description: 'Combines major thrombophilia SNPs',
    snps: [
      { rsid: 'rs6025', riskAllele: 'T', weight: 4 }, // Factor V Leiden
      { rsid: 'rs1799963', riskAllele: 'A', weight: 3 }, // Prothrombin
    ],
    interpret: (score, max, found) => {
      if (found < 2) return 'Incomplete data — need both Factor V and Prothrombin';
      if (score >= 7)
        return 'MULTIPLE clotting risk factors — STRONGLY recommend discussing with hematologist, especially before surgery, long flights, or hormonal medications.';
      if (score >= 3)
        return 'ONE significant clotting variant detected — mention to your doctor. Consider compression socks for long flights.';
      return 'No major clotting variants detected — normal thrombosis risk from these loci.';
    },
  },
  {
    name: 'Caffeine Profile',
    description: 'Metabolism speed + anxiety sensitivity = your coffee personality',
    snps: [
      { rsid: 'rs762551', riskAllele: 'C', weight: 2 }, // CYP1A2 slow metabolizer
      { rsid: 'rs5751876', riskAllele: 'T', weight: 2 }, // ADORA2A anxiety
    ],
    interpret: (score, max, found) => {
      if (found < 2) return 'Need both CYP1A2 and ADORA2A for full picture';
      if (score >= 6)
        return "CAFFEINE SENSITIVE: slow metabolism + anxiety-prone. You're the person who can't drink coffee after noon and gets jittery from a latte.";
      if (score >= 4)
        return 'MODERATE sensitivity: either slow metabolism or anxiety-prone, but not both. Moderate your intake.';
      if (score >= 2) return 'MILD sensitivity: one factor present. Most coffee is fine for you.';
      return 'CAFFEINE BULLETPROOF: fast metabolism + low anxiety response. Espresso martini at 9pm? Your genetics say go for it.';
    },
  },
  {
    name: 'Autoimmune Risk Profile',
    description: 'Combines major autoimmune risk SNPs across conditions',
    snps: [
      { rsid: 'rs2476601', riskAllele: 'A', weight: 3 }, // PTPN22
      { rsid: 'rs231775', riskAllele: 'G', weight: 2 }, // CTLA4
      { rsid: 'rs7574865', riskAllele: 'T', weight: 2 }, // STAT4
      { rsid: 'rs1800629', riskAllele: 'A', weight: 1 }, // TNF-alpha
    ],
    interpret: (score, max, found) => {
      if (found < 3) return 'Insufficient data for autoimmune profile';
      const pct = score / max;
      if (pct >= 0.5)
        return 'ELEVATED autoimmune genetic load. Multiple risk alleles across pathways. If you have unexplained fatigue, joint pain, or skin changes, consider autoimmune screening (ANA, TSH, CRP).';
      if (pct >= 0.25)
        return "MODERATE autoimmune risk. Some predisposition — awareness is useful but don't over-worry.";
      return 'LOWER autoimmune genetic risk. Fewer risk alleles across the major pathways.';
    },
  },
  {
    name: 'Macular Degeneration Combined Risk',
    description: 'CFH + ARMS2 — the two major AMD loci',
    snps: [
      { rsid: 'rs1061170', riskAllele: 'C', weight: 3 }, // CFH
      { rsid: 'rs10490924', riskAllele: 'T', weight: 3 }, // ARMS2
    ],
    interpret: (score, max, found) => {
      if (found < 2) return 'Need both CFH and ARMS2 for combined risk';
      if (score >= 8)
        return 'HIGH combined AMD risk. Both major pathways affected. Lutein/zeaxanthin supplements, omega-3, UV protection, and not smoking are your best defenses. Start eye exams with retinal imaging.';
      if (score >= 4)
        return 'MODERATE AMD risk. One major pathway affected. Standard eye health practices recommended.';
      return 'LOWER AMD risk. Keep up general eye health (UV protection, nutrition).';
    },
  },
  {
    name: 'Vitamin D Needs',
    description: 'Combines synthesis + binding for overall vitamin D picture',
    snps: [
      { rsid: 'rs2282679', riskAllele: 'G', weight: 2 }, // GC binding protein
      { rsid: 'rs12785878', riskAllele: 'G', weight: 2 }, // DHCR7 synthesis
    ],
    interpret: (score, max, found) => {
      if (found < 2) return 'Need both SNPs for combined assessment';
      if (score >= 6)
        return 'BOTH synthesis and transport compromised. You likely need vitamin D supplementation year-round, even with sun exposure. Get 25(OH)D levels tested.';
      if (score >= 3)
        return 'ONE pathway affected. Supplementation recommended in winter months or with indoor lifestyle.';
      return 'Normal vitamin D genetics. Standard recommendations: sunlight + dietary sources should be sufficient.';
    },
  },
];

export function calculatePolygenicScore(
  pg: PolygenicScore,
  snps: Map<string, SNPRecord>
): { score: number; max: number; found: number } {
  let score = 0;
  let max = 0;
  let found = 0;

  for (const snp of pg.snps) {
    const record = snps.get(snp.rsid);
    if (!record) continue;
    found++;
    max += snp.weight * 2; // max 2 alleles
    if (record.allele1 === snp.riskAllele) score += snp.weight;
    if (record.allele2 === snp.riskAllele) score += snp.weight;
  }

  return { score, max, found };
}

// ============================================================
//  Parser & Helpers
// ============================================================

export interface SNPRecord {
  rsid: string;
  chromosome: string;
  position: string;
  allele1: string;
  allele2: string;
}

/**
 * Parse raw AncestryDNA / 23andMe tab-delimited content into a map keyed by
 * rsid. Tolerates `#`-prefixed comments, blank lines, and skips no-call rows
 * (any row where either allele is `0`).
 */
export function parseDNAContent(content: string): Map<string, SNPRecord> {
  const lines = content.split('\n');
  const snps = new Map<string, SNPRecord>();

  for (const line of lines) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const parts = line.replace(/\r/g, '').split('\t');
    if (parts.length < 5) continue;
    const [rsid, chromosome, position, allele1, allele2] = parts;
    if (allele1 === '0' || allele2 === '0') continue; // skip no-calls
    snps.set(rsid, { rsid, chromosome, position, allele1, allele2 });
  }

  return snps;
}

export function interpretAPOE(snps: Map<string, SNPRecord>): string | null {
  const rs429358 = snps.get('rs429358');
  const rs7412 = snps.get('rs7412');
  if (!rs429358 || !rs7412) return null;

  const has429C = rs429358.allele1 === 'C' || rs429358.allele2 === 'C';
  const has429CC = rs429358.allele1 === 'C' && rs429358.allele2 === 'C';
  const has7412T = rs7412.allele1 === 'T' || rs7412.allele2 === 'T';
  const has7412TT = rs7412.allele1 === 'T' && rs7412.allele2 === 'T';

  // e2 = rs429358-T + rs7412-T
  // e3 = rs429358-T + rs7412-C (most common)
  // e4 = rs429358-C + rs7412-C
  if (!has429C && has7412TT)
    return "  >>> APOE type: e2/e2 — lowest Alzheimer's risk. Slightly higher triglyceride variation.";
  if (!has429C && has7412T)
    return "  >>> APOE type: e2/e3 — generally favorable. Lower cardiovascular and Alzheimer's risk.";
  if (!has429C && !has7412T)
    return '  >>> APOE type: e3/e3 — most common (~60% of people). Neutral baseline risk.';
  if (has429C && !has429CC && !has7412T)
    return "  >>> APOE type: e3/e4 — one e4 allele (~25% of people). Modestly increased Alzheimer's risk (~2-3x). Most e4 carriers never develop Alzheimer's. Exercise, sleep, and cardiovascular health are protective.";
  if (has429CC && !has7412T)
    return "  >>> APOE type: e4/e4 — two e4 alleles (~2-3% of people). Significantly increased Alzheimer's risk (~10-15x lifetime). NOT deterministic — many e4/e4 individuals live to old age cognitively intact. Exercise, sleep quality, cardiovascular health, and social engagement are strongly protective.";
  if (has429C && has7412T)
    return '  >>> APOE type: e2/e4 — mixed effects, may partially offset each other.';

  return '  >>> APOE type: unusual combination — consider clinical confirmation';
}

// ============================================================
//  Structured result shape + top-level parseDNA wrapper
// ============================================================

export interface TraitReading {
  rsid: string;
  gene: string;
  trait: string;
  category: string;
  genotype: string; // e.g., "A/G"
  interpretation: string; // human-readable text from the SNP's interpret()
}

export interface PolygenicReading {
  name: string;
  description: string;
  snpsFound: number;
  snpsTotal: number;
  score: number;
  max: number;
  interpretation: string;
}

export interface DNAParseResult {
  snpsLoaded: number;
  chipCoverageEstimate: number; // rough % of ~4.5M common human variants
  traits: TraitReading[];
  health: TraitReading[];
  experimental: TraitReading[];
  polygenic: PolygenicReading[];
  apoe: string | null; // the full APOE readout if available
  missing: {
    traits: number;
    health: number;
    experimental: number;
  };
}

function renderCategory(
  snpList: TraitSNP[],
  snps: Map<string, SNPRecord>
): { readings: TraitReading[]; missing: number } {
  const readings: TraitReading[] = [];
  const seen = new Set<string>();
  let missing = 0;

  for (const trait of snpList) {
    if (seen.has(trait.rsid)) continue; // rs601338 appears in multiple categories
    seen.add(trait.rsid);

    const record = snps.get(trait.rsid);
    if (!record) {
      missing++;
      continue;
    }
    readings.push({
      rsid: trait.rsid,
      gene: trait.gene,
      trait: trait.trait,
      category: trait.category,
      genotype: `${record.allele1}/${record.allele2}`,
      interpretation: trait.interpret(record.allele1, record.allele2),
    });
  }

  return { readings, missing };
}

/**
 * Parse raw AncestryDNA / 23andMe content into structured readings across
 * every SNP table (traits, health, experimental) plus polygenic scores and
 * APOE genotype. The returned object is JSON-serializable — no functions,
 * no Map, no Buffer.
 */
export function parseDNA(content: string): DNAParseResult {
  const snps = parseDNAContent(content);
  const traits = renderCategory(TRAIT_SNPS, snps);
  const health = renderCategory(HEALTH_SNPS, snps);
  const experimental = renderCategory(EXPERIMENTAL_SNPS, snps);

  const polygenic: PolygenicReading[] = POLYGENIC_SCORES.map((pg) => {
    const { score, max, found } = calculatePolygenicScore(pg, snps);
    return {
      name: pg.name,
      description: pg.description,
      snpsFound: found,
      snpsTotal: pg.snps.length,
      score,
      max,
      interpretation: pg.interpret(score, max, found),
    };
  });

  return {
    snpsLoaded: snps.size,
    chipCoverageEstimate: +((snps.size / 4_500_000) * 100).toFixed(1),
    traits: traits.readings,
    health: health.readings,
    experimental: experimental.readings,
    polygenic,
    apoe: interpretAPOE(snps),
    missing: {
      traits: traits.missing,
      health: health.missing,
      experimental: experimental.missing,
    },
  };
}
