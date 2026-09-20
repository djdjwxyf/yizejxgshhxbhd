/* ============================================================
 * 留言板 · 后端配置
 * ------------------------------------------------------------
 * 【只有这一个文件需要你改】
 *
 * 用 Twikoo（推荐，挂腾讯云开发，国内访问快）：
 *   1. 把 type 保持 'twikoo'
 *   2. 把 twikoo.envId 填成你的云开发环境 ID（形如 love-8gk2xxxxx）
 *   3. 保存 → hexo clean && hexo g && hexo d
 *
 * 用 Waline：
 *   1. type 改成 'waline'
 *   2. waline.serverURL 填服务端地址（形如 https://comment.weiyiting.cn）
 *
 * 两个都留空 → 页面会显示"还没连接后端"的设置指引，不会报错。
 * ============================================================ */

window.MESSAGE_CONFIG = {
  /* 'twikoo' | 'waline' */
  type: 'twikoo',

  twikoo: {
    /* 腾讯云开发环境 ID */
    envId: '',
    lang: 'zh-CN',
    /* 想要评论必须先登录？'none'=谁都能留言（她不用注册，推荐）；'admin'=只有管理员 */
    login: 'none',
    /* 一次加载几条 */
    pageSize: 20
  },

  waline: {
    /* Waline 服务端地址 */
    serverURL: ''
  }
};
