const DEPARTMENT_COLLEGES = [
  {
    college: '인문과학대학',
    departments: ['국어국문학과', '국제학부', '역사학과', '교육학과', '글로벌인재학부'],
  },
  {
    college: '사회과학대학',
    departments: ['행정학과', '미디어커뮤니케이션학과', '법학과'],
  },
  {
    college: '경영경제대학',
    departments: ['경영학부', '경제학과'],
  },
  {
    college: '호텔관광대학',
    departments: [
      '호텔관광경영학',
      '외식경영학',
      '호텔외식관광프랜차이즈경영학과',
      '조리서비스경영학과',
      '호텔외식비즈니스학과',
    ],
  },
  {
    college: '자연과학대학',
    departments: ['수학통계학과', '물리천문학과', '화학과'],
  },
  {
    college: '생명과학대학',
    departments: ['식품생명공학', '바이오융합공학', '바이오산업자원공학', '스마트생명산업융합학과'],
  },
  {
    college: '인공지능융합대학',
    departments: [
      'AI융합전자공학과',
      '반도체시스템공학과',
      '컴퓨터공학과',
      '정보보호학과',
      '양자지능정보학과',
      '디자인이노베이션',
      '만화애니메이션텍',
      '지능IoT학과',
      '사이버국방학과',
      '국방AI로봇융합공학과',
      '인공지능데이터사이언스학과',
      'AI로봇학과',
      '지능정보융합학과',
      '콘텐츠소프트웨어학과/소프트웨어학과',
    ],
  },
  {
    college: '공과대학',
    departments: [
      '건축공학과',
      '건축학과',
      '건설환경공학과',
      '환경융합공학과',
      '에너지자원공학과',
      '기계공학과',
      '우주항공시스템공학부',
      '나노신소재공학과',
      '양자원자력공학과',
      '국방AI융합시스템공학과',
    ],
  },
  {
    college: '예체능대학',
    departments: ['회화과', '패션디자인학과', '음악과', '체육학과', '무용과', '영화예술학과'],
  },
  {
    college: '대양휴머니티칼리지',
    departments: ['자유전공학부'],
  },
  {
    college: '전공자율선택',
    departments: ['인문사회계열', '경상호텔관광계열', '자연생명계열', 'IT계열', '첨단융합계열', '공과계열'],
  },
];

const DEPARTMENT_SET = new Set(DEPARTMENT_COLLEGES.flatMap((group) => group.departments));

/** @param {unknown} value */
function normalizeDepartment(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const department = String(value).trim();
  return department && DEPARTMENT_SET.has(department) ? department : null;
}

function departmentPayload() {
  return {
    colleges: DEPARTMENT_COLLEGES,
    departments: DEPARTMENT_COLLEGES.flatMap((group) =>
      group.departments.map((department) => ({ college: group.college, department })),
    ),
  };
}

module.exports = {
  DEPARTMENT_COLLEGES,
  normalizeDepartment,
  departmentPayload,
};
