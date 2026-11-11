// 화면 문장(한국어). 키를 더하면 en.ts 에도 같은 키를 넣어야 타입 검사를 통과한다.
export const ko = {
  // 공통
  'common.error': '문제가 생겼어요',
  'common.unknown': '알 수 없음',
  'common.close': '닫기',
  'common.copy': '복사',
  'common.copied': '복사됨',
  'common.cancel': '취소',
  'common.send': '보내기',
  'common.save': '저장',
  'common.pending': '승인 대기',
  'common.channel': '채널',
  'common.myAgent': '내 에이전트',
  'common.agentOf': (p: { name: string }) => `${p.name}의 에이전트`,
  'common.noAgent': '에이전트 없음',
  'common.download': '내려받기',

  // 단계
  'stage.request': '요청',
  'stage.draft': '초안',
  'stage.review': '검토',
  'stage.final': '확정',

  // 에이전트
  'agent.builtin': '내장 에이전트',
  'agent.connect': '에이전트 연결',

  // 시스템 메시지(중계 서버 문장과 같게)
  'system.joined': (p: { name: string }) => `${p.name}님이 들어왔어요`,
  'system.stageChanged': (p: { name: string; stage: string }) => `${p.name}님이 단계를 「${p.stage}」(으)로 바꿨어요`,
  'system.approvalToggled': (p: { name: string; on: boolean }) => `${p.name}님이 에이전트 발언 승인을 ${p.on ? '켰어요' : '껐어요'}`,
  'system.agentToggled': (p: { name: string; on: boolean }) => `${p.name}님의 에이전트가 ${p.on ? '참여해요' : '빠졌어요'}`,
  'system.docSigned': (p: { name: string; title: string; version: number; signed: number; total: number }) =>
    `${p.name}님이 「${p.title}」 v${p.version}에 동의했어요 (${p.signed}/${p.total})`,
  'system.docFinalized': (p: { title: string; version: number }) => `「${p.title}」 v${p.version}을 모두 확정했어요`,

  // 중계 서버 연결
  'api.offline': '서버에 연결할 수 없어요',
  'api.error': (p: { status: number }) => `오류 (${p.status})`,

  // 알림
  'notify.permission': 'Claude Code 실행 승인 요청',
  'notify.draftPending': '내 에이전트가 승인을 기다려요',
  'notify.docDraft': '문서 초안',
  'notify.myAgent': (p: { title: string }) => `내 에이전트 · ${p.title}`,
  'notify.docPosted': '문서를 올렸어요',
  'notify.mentioned': (p: { who: string; title: string }) => `${p.who} · 나를 불렀어요 (${p.title})`,

  // @멘션
  'mention.list': '부를 사람',

  // 입력창 위 승인
  'dock.title': (p: { n: number }) => `내 에이전트가 승인을 기다려요 · ${p.n}`,
  'dock.approveAll': '모두 보내기',
  'dock.always': '항상 모두 승인',
  'dock.hint': '입력창 위에서 보낼지 정해 주세요',

  // 항상 모두 승인
  'auto.title': '항상 모두 승인',
  'auto.desc': '내 에이전트의 메시지·문서·파일과 도구 실행을 확인 없이 바로 처리해요',
  'auto.chip': '자동 승인',
  'auto.chipHint': '눌러서 자동 승인 끄기',
  'auto.enabled': '항상 모두 승인을 켰어요. 입력창의 ‘자동 승인’을 누르면 꺼져요',
  'auto.disabled': '자동 승인을 껐어요',

  // 파일
  'file.empty': (p: { name: string }) => `${p.name}: 빈 파일이에요`,
  'file.tooBig': (p: { name: string }) => `${p.name}: 25MB까지 올릴 수 있어요`,
  'file.pastedImage': (p: { stamp: string }) => `붙여넣은 이미지 ${p.stamp}`,
  'file.kind': '파일',
  'file.viewLarge': (p: { name: string }) => `${p.name} 크게 보기`,

  // 모델
  'model.changeFailed': '모델을 바꾸지 못했어요',
  'model.changed': (p: { name: string }) => `내 에이전트 모델 · ${p.name}`,
  'model.default': (p: { name: string }) => `기본 · ${p.name}`,
  'model.defaultShort': '기본',
  'model.label': '모델',
  'model.aria': (p: { name: string }) => `내 에이전트 모델: ${p.name}`,
  'model.header': '내 에이전트 모델 · 다음 답부터 적용',
  'model.menu': '내 에이전트 모델',
  'model.pinned': (p: { n: number }) => `버전 고정 모델 ${p.n}개`,
  'model.note.default': '에이전트 기본 설정을 따라요',
  'model.note.opus': '복잡한 일과 일상 업무에',
  'model.note.fable': '가장 어렵고 오래 걸리는 일에',
  'model.note.sonnet': '간단한 일을 빠르고 효율적으로',
  'model.note.haiku': '가장 빠른 답이 필요할 때',

  // 위 막대·사이드바
  'nav.openSidebar': '사이드바 열기',
  'nav.closeSidebar': '사이드바 닫기',
  'nav.newChannel': '새 채널',
  'nav.search': '채널 검색',
  'nav.approvals': '승인함',
  'nav.channels': '채널',
  'nav.settings': '설정',
  'nav.logout': '로그아웃',
  'nav.offline': '서버 연결 끊김',
  'nav.agentState': (p: { agent: string; online: boolean }) => `${p.agent} ${p.online ? '접속 중' : '꺼짐'}`,

  // 입력창
  'composer.privatePlaceholder': '내 에이전트에게만 보이는 지시',
  'composer.add': '더하기',
  'composer.addAria': '파일·문서 더하기',
  'composer.uploadFile': '내 PC의 파일 올리기',
  'composer.toMyAgent': '내 에이전트에게',
  'composer.uploading': (p: { n: number }) => `파일 ${p.n}개 올리는 중`,

  // 처음 화면·승인함
  'home.title': '어떤 일을 같이 할까요?',
  'home.placeholder': '무슨 일인지 적으면 채널이 열려요',
  'approvals.empty': '모두 처리했어요',
  'approvals.tools': '도구 실행',
  'approvals.drafts': '상대에게 보낼 초안',
  'permission.allow': '허용',
  'permission.deny': '거부',

  // 시작하기
  'onboarding.title': '시작하기',
  'onboarding.name': '이름',
  'onboarding.server': '서버 주소',
  'onboarding.continue': '계속',
  'onboarding.changeServer': '서버 주소 바꾸기',
  'onboarding.failed': '시작하지 못했어요',

  // 메시지
  'message.onlyMe': '나에게만',
  'message.edited': '· 마스터가 고침',
  'draft.fileNotice': '내 PC의 파일을 채널에 올리려고 해요. 내용을 확인하고 보내 주세요.',
  'draft.sendEdited': '고쳐서 보내기',
  'draft.edit': '고치기',
  'draft.discard': '버리기',

  // 채널
  'channel.invite': '초대',
  'channel.docs': '문서',
  'channel.placeholder': '채널에 메시지 보내기 · @로 누군가에게 요청',
  'channel.dropTitle': '놓으면 바로 올려요',
  'channel.dropPrivate': '내 에이전트에게만 보여요',
  'channel.dropPublic': '채널의 모두에게 보여요 · 25MB까지',
  'channel.invitePeople': '함께할 사람 초대',
  'channel.stage': '단계',
  'channel.requireApproval': '에이전트 발언 승인 후 공개',
  'channel.requireApprovalToggle': '에이전트 발언 승인',
  'channel.turnLimit': '에이전트끼리 연속 발언',
  'channel.decrease': '줄이기',
  'channel.increase': '늘리기',
  'channel.myAgentJoins': '내 에이전트 참여',
  'channel.rename': '이름 바꾸기',
  'channel.you': ' (나)',
  'channel.agentOff': (p: { agent: string }) => `${p.agent} · 이 채널엔 빠짐`,
  'channel.agentState': (p: { agent: string; online: boolean }) => `${p.agent} · ${p.online ? '접속 중' : '부재중'}`,

  // 문서
  'doc.title': '문서',
  'doc.list': '문서 목록',
  'doc.new': '새 문서',
  'doc.writeFirst': '첫 문서 쓰기',
  'doc.untitled': '문서',
  'doc.cardMeta': (p: { version: number | null }) => `문서 · v${p.version}`,
  'doc.final': '확정',
  'doc.newVersionOf': (p: { title: string }) => `${p.title} · 새 버전`,
  'doc.titlePlaceholder': '문서 제목',
  'doc.bodyPlaceholder': '마크다운으로 써 주세요',
  'doc.notePlaceholder': '무엇을 바꿨는지 (선택)',
  'doc.post': '올리기',
  'doc.compare': '이전 버전과 비교',
  'doc.editAsNew': '고쳐서 새 버전',
  'doc.pendingOther': '작성자 쪽 승인을 기다리는 버전이에요',
  'doc.signState': (p: { name: string; signed: boolean }) => `${p.name} ${p.signed ? '동의' : '대기'}`,
  'doc.allFinal': '모두 확정했어요',
  'doc.signCount': (p: { signed: number; total: number }) => `동의 ${p.signed}/${p.total}`,
  'doc.applyRequest': '내 도구에 반영 요청',
  'doc.applyInstruction': (p: { title: string; version: number; id: string }) =>
    `확정된 문서 「${p.title}」 v${p.version} (document_id=${p.id})를 내 노션·지라에 반영해줘. 어디에 반영할지 모르겠으면 먼저 물어봐.`,
  'doc.applyRequested': '내 에이전트에게 반영을 요청했어요',
  'doc.signed': '동의함',
  'doc.finalize': '이 버전으로 확정',

  // 설정
  'settings.title': '설정',
  'settings.general': '일반',
  'settings.agents': '에이전트',
  'settings.account': '계정',
  'settings.theme': '테마',
  'settings.themeSystem': '시스템',
  'settings.themeLight': '라이트',
  'settings.themeDark': '다크',
  'settings.language': '언어',
  'settings.languageSub': '내 에이전트도 이 언어로 보고해요',
  'settings.server': '서버',
  'settings.name': '이름',

  'runner.off': '꺼져 있어요',
  'runner.connecting': '서버에 붙는 중',
  'runner.online': '접속 중',
  'runner.idle': '접속 중 · 대기',
  'runner.starting': '접속 중 · Claude 켜는 중',
  'runner.working': '접속 중 · 일하는 중',
  'runner.error': '문제가 생겼어요',
  'runner.stopped': '멈췄어요',

  'agents.connectFailed': '연결하지 못했어요',
  'agents.desktopOnly': '데스크톱 앱에서 연결할 수 있어요',
  'agents.checking': '확인 중',
  'agents.missing': (p: { name: string }) => `${p.name}가 설치돼 있지 않아요`,
  'agents.notConnected': '연결 안 됨',
  'agents.reconnect': '다시 연결',
  'agents.connect': '연결',
  'agents.about': (p: { name: string }) => `앱이 켜져 있는 동안 ${p.name}를 직접 돌려요. 터미널을 열어 둘 필요 없고, 도구 실행 확인은 승인함으로 와요.`,
  'agents.changeFolder': '폴더 바꾸기',
  'agents.modelHint': '모델은 채팅 입력창의 모델 버튼에서 바꿔요.',
  'agents.restart': '다시 시작',
  'agents.log': '기록 보기',
  'agents.apiKey': 'API 키로 쓰는 내장 에이전트',
  'agents.soon': '곧 지원',

  // 초대·참여·검색
  'invite.title': '초대 코드',
  'invite.hint': '상대가 ‘초대 코드로 참여’에 넣으면 들어와요',
  'join.title': '초대 코드로 참여',
  'join.button': '참여',
  'join.failed': '참여하지 못했어요',
  'search.placeholder': '채널 검색',
  'preview.doc': (p: { title: string }) => `문서: ${p.title}`,
  'preview.file': (p: { name: string }) => `파일: ${p.name}`,
}
