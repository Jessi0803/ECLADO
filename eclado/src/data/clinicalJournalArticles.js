// Internal source tracing: docs/CLINICAL-JOURNAL-SOURCES.md.
// Preserve existing slugs; public copy is skincare editorial, not clinical proof.
export const CLINICAL_JOURNAL_ARTICLES = [
  {
    slug: 'azulene-ampoule-clinical-data', category: '成分與保養',
    title: '乾燥緊繃時，給肌膚柔潤的日常照護',
    excerpt: '從癒創藍油烴到植物油脂，認識藍色安瓶的配方與質地，找到適合自己的柔潤保養方式。',
    seoDescription: '認識洋甘菊舒緩安瓶的癒創藍油烴、植物角鯊烷與油脂配方，從質地與日常搭配了解滋潤保養。',
    img: '/assets/images/journal-clinical-azulene.jpg', imageFit: 'contain', imageBackground: '#ffffff',
    sections: [
      { heading: '保養，不一定要再多加一道步驟', paragraphs: [
        '乾燥、緊繃時，選擇保養品除了看成分，也可以從自己喜歡的質地開始。洋甘菊舒緩安瓶以油性質地為特色，適合想在日常保養中增加柔潤膚感的人認識。',
        '與清爽水感的精華相比，油性安瓶著重滋潤的使用感受。先理解不同質地的角色，再決定是否加入既有流程，不必一次疊擦許多產品。',
      ]},
      { heading: '認識配方中的癒創藍油烴', paragraphs: [
        '癒創藍油烴（Guaiazulene）是這款藍色安瓶的特色成分之一，配方也搭配植物來源油脂。選擇時不必只聚焦單一成分名稱，整體質地、延展性與擦拭後的感受，同樣值得留意。',
        '成分表能幫助我們認識產品組成，但不能只憑某一種成分或濃度，判斷整款產品的效果。回到自己的保養需求，會比追逐醒目的成分標語更實際。',
      ]},
      { heading: '用油潤質地，照顧日常的柔潤需求', paragraphs: [
        '植物角鯊烷、摩洛哥堅果油與夏威夷果油，是這款安瓶油脂配方的一部分。對喜歡柔潤膚感的人來說，油性質地提供了不同於凝膠的保養選擇。',
        '水感與油潤並沒有絕對的優劣。可以先看看現有保養中是否已有相近質地，再決定如何搭配，讓每一步都有自己的角色。',
      ]},
      { heading: '把舒適的使用感受，留給自己判斷', paragraphs: [
        '挑選產品時，可以留意擦拭後是否過於厚重、與後續乳霜或防曬是否容易搭配。保養不需要越濃越好，也不需要程序越多越好。',
        '從簡單的流程開始，依產品標示使用，再觀察自己的膚感偏好，讓滋潤保養成為容易持續的日常。',
      ], notes: ['實際成分與使用方式請以台灣販售產品標示為準；使用感受因人而異。'] },
    ],
  },
  {
    slug: 'exo-clinica-gel-clinical-data', category: '成分與保養',
    title: '補水不必厚重，找回清爽舒適的保養節奏',
    excerpt: '想保濕，又不喜歡厚重膚感？從水感凝膠的質地與日常搭配，認識清爽保養的另一種選擇。',
    seoDescription: '認識精萃凝膠的水感質地，從延展性、保濕需求與日常搭配，找到清爽舒適的保養節奏。',
    // User-selected product imagery; packaging claims still require brand review.
    img: '/assets/images/journal-hydration-wide.png', imageFit: 'cover',
    mobileImg: '/assets/images/journal-hydration-cover.png',
    sections: [
      { heading: '想要保濕，不一定想要厚重', paragraphs: [
        '挑選保濕產品時，除了滋潤感，也有人更在意清爽、好延展的質地。精萃凝膠以水感凝膠為特色，提供不同於油性安瓶或乳霜的保養選擇。',
        '保養的重點不在於程序多寡，而是選擇自己願意每天使用的搭配。若不喜歡厚重的膚感，可以從較輕盈的質地開始認識。',
      ]},
      { heading: '認識質地，不只看熱門成分', paragraphs: [
        '一款產品的使用感受，來自整體配方，而不是單一成分名稱。閱讀產品標示之外，也可以留意凝膠的延展性、擦拭後的觸感，以及與既有保養品搭配時的感受。',
        '清爽是質地偏好，不代表保濕效果必然更強；厚潤也不代表一定更適合自己。把膚感與需求分開思考，更容易找到日常用得舒服的選擇。',
      ]},
      { heading: '讓每一步保養各有角色', paragraphs: [
        '如果目前已經使用水感精華，可以先思考是否需要再加入相似質地的產品；如果更喜歡油潤的包覆感，則可以比較乳霜或油性安瓶的使用感受。',
        '依產品標示安排使用方式，避免只是為了增加步驟而疊擦。簡單、方便搭配的流程，也能讓日常保養更容易持續。',
      ]},
      { heading: '找到自己的清爽保養節奏', paragraphs: [
        '選擇凝膠，可以從三件小事觀察：是否容易推開、擦拭後是否符合喜歡的膚感，以及是否方便銜接後續保養。這些貼近日常的感受，往往比一個醒目的成分名稱更有參考價值。',
        '回到自己在意的水感、柔潤或舒適度，保留合適的步驟即可，不必把所有質地都放進同一套流程。',
      ], notes: ['實際成分與使用方式請以台灣販售產品標示為準；使用感受因人而異。'] },
    ],
  },
];
