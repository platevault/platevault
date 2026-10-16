// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The message-only window that receives the volume notices.
//!
//! Windows sends a handle registration's notices to the window procedure,
//! which applies them to the thread's registrations. The thread's message loop
//! takes the queued roots and the stop request, both posted from other
//! threads, and the retry timer's ticks, which run while a root has no
//! registration. The thread pumps no messages while it runs a callback, so
//! the procedure is never re-entered.

use std::cell::RefCell;
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::hash::Hash;
use std::io;
use std::mem;
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};
use std::ptr;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use windows_sys::Win32::Foundation::{
    ERROR_CLASS_ALREADY_EXISTS, HWND, LPARAM, LRESULT, TRUE, WPARAM,
};
use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_BACKUP_SEMANTICS;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW, KillTimer,
    PostMessageW, RegisterClassExW, RegisterDeviceNotificationW, SetTimer,
    UnregisterDeviceNotification, DBT_DEVICEQUERYREMOVE, DBT_DEVICEQUERYREMOVEFAILED,
    DBT_DEVICEREMOVECOMPLETE, DBT_DEVICEREMOVEPENDING, DBT_DEVTYP_HANDLE,
    DEVICE_NOTIFY_WINDOW_HANDLE, DEV_BROADCAST_HANDLE, DEV_BROADCAST_HDR, HDEVNOTIFY, HWND_MESSAGE,
    MSG, WM_APP, WM_DEVICECHANGE, WM_TIMER, WNDCLASSEXW,
};

use crate::registrations::{Notice, Registrations};
use crate::Removal;

/// Posted once new roots are queued.
const ROOTS: u32 = WM_APP;
/// Posted to end the thread.
const STOP: u32 = WM_APP + 1;
/// Sent by the tests with a `*mut Vec<usize>` to read the registration ids.
#[cfg(test)]
const IDS: u32 = WM_APP + 2;
/// The window class every `RemovalNotices` in the process shares.
const CLASS: &str = "PlateVaultRemovalNotices";
/// The timer that retries the roots left without a registration.
const RETRY_TIMER: usize = 1;
/// How often a root that could not be opened or registered, or was not
/// reopened after a refused removal, is tried again.
const RETRY: Duration = Duration::from_secs(30);
/// Grants a requested removal; `BROADCAST_QUERY_DENY` would refuse it.
const GRANT: LRESULT = TRUE as LRESULT;
#[expect(clippy::cast_possible_truncation, reason = "the struct is a few dozen bytes")]
const CLASS_SIZE: u32 = mem::size_of::<WNDCLASSEXW>() as u32;
#[expect(clippy::cast_possible_truncation, reason = "the struct is a few dozen bytes")]
const FILTER_SIZE: u32 = mem::size_of::<DEV_BROADCAST_HANDLE>() as u32;
/// How much of a `DEV_BROADCAST_HANDLE` holds the registration it names.
const NOTIFICATION_END: usize =
    mem::offset_of!(DEV_BROADCAST_HANDLE, dbch_hdevnotify) + mem::size_of::<HDEVNOTIFY>();

/// A message-only window on its own thread, registered for the removal
/// notices of the volume holding each root its [`Roots`] give it. A root
/// that could not be opened or registered, or was not reopened after a
/// refused removal, is tried again every 30 s until it registers or leaves.
///
/// Dropping it ends every registration and the thread, and waits for a
/// callback that is still running.
pub struct RemovalNotices<K> {
    roots: Roots<K>,
    thread: Option<thread::JoinHandle<()>>,
}

/// Gives a [`RemovalNotices`] window the roots to register.
#[derive(Clone)]
pub struct Roots<K> {
    queue: mpsc::Sender<HashMap<K, PathBuf>>,
    /// The window's handle as an address, since an `HWND` cannot cross
    /// threads. It only goes back to `PostMessageW`.
    window: usize,
}

impl<K: Clone + Eq + Hash + Send + 'static> RemovalNotices<K> {
    /// Start the window thread. `removal` runs on it for each notice about the
    /// volume holding a registered root, given that root's key. Windows goes
    /// ahead with a requested removal only once `removal` returned for
    /// [`Removal::Requested`].
    ///
    /// # Errors
    /// The thread did not start, or Windows refused the window.
    pub fn start(removal: impl FnMut(&K, Removal) + Send + 'static) -> io::Result<Self> {
        Self::start_with(RETRY, removal)
    }

    /// [`start`](Self::start), trying unregistered roots again every `retry`.
    fn start_with(
        retry: Duration,
        removal: impl FnMut(&K, Removal) + Send + 'static,
    ) -> io::Result<Self> {
        let (queue, queued) = mpsc::channel();
        let (created, window) = mpsc::sync_channel(1);
        let removal: Box<dyn FnMut(&K, Removal) + Send> = Box::new(removal);
        let retry = u32::try_from(retry.as_millis()).unwrap_or(u32::MAX);
        let thread = thread::Builder::new()
            .name("removal-notices".into())
            .spawn(move || run(queued, removal, retry, &created))?;
        let window = window.recv().unwrap_or_else(|_| {
            Err(io::Error::other("the removal notice thread ended before its window existed"))
        });
        match window {
            Ok(window) => Ok(Self { roots: Roots { queue, window }, thread: Some(thread) }),
            Err(error) => {
                let _ = thread.join();
                Err(error)
            }
        }
    }

    /// A handle that gives the window the roots to register.
    #[must_use]
    pub fn roots(&self) -> Roots<K> {
        self.roots.clone()
    }
}

impl<K> Drop for RemovalNotices<K> {
    fn drop(&mut self) {
        post(self.roots.window, STOP);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl<K> Roots<K> {
    /// Have the window register exactly `roots`, by key, in place of the last
    /// ones. `false` once the window is gone.
    #[must_use = "`false` means the window is gone"]
    pub fn watch(&self, roots: HashMap<K, PathBuf>) -> bool {
        // The queue closes before the window is destroyed, so nothing posts to
        // a window handle Windows may have reused.
        self.queue.send(roots).is_ok() && post(self.window, ROOTS)
    }
}

/// Queue `message` for the window; `false` when Windows refused it.
fn post(window: usize, message: u32) -> bool {
    // SAFETY: PostMessageW only queues a message without parameters, and
    // Windows refuses a handle that no longer names a window.
    #[allow(unsafe_code)]
    let posted = unsafe { PostMessageW(ptr::without_provenance_mut(window), message, 0, 0) };
    posted != 0
}

/// The window thread: create the window, report it, then serve its messages
/// until asked to stop. Unregistered roots are retried every `retry` ms.
fn run<K: Clone + Eq + Hash + 'static>(
    queued: mpsc::Receiver<HashMap<K, PathBuf>>,
    removal: Box<dyn FnMut(&K, Removal) + Send>,
    retry: u32,
    created: &mpsc::SyncSender<io::Result<usize>>,
) {
    let window = match create_window() {
        Ok(window) => window,
        Err(error) => {
            let _ = created.send(Err(error));
            return;
        }
    };
    HANDLER.set(Some(Box::new(Handler {
        window,
        registrations: Registrations::new(open_root),
        queued,
        roots: HashMap::new(),
        removal,
        retry,
        retrying: false,
    })));
    let _ = created.send(Ok(window.addr()));
    let mut message = MSG::default();
    loop {
        // SAFETY: `message` is a MSG for GetMessageW to fill in; a null window
        // takes every message of this thread. It returns 0 for WM_QUIT and -1
        // on an error, which both end the loop.
        #[allow(unsafe_code)]
        let got = unsafe { GetMessageW(&raw mut message, ptr::null_mut(), 0, 0) };
        if got <= 0 {
            break;
        }
        match message.message {
            STOP => break,
            ROOTS => with_handler(|handler| handler.follow()),
            WM_TIMER if message.wParam == RETRY_TIMER => with_handler(|handler| handler.follow()),
            _ => {
                // SAFETY: `message` was just filled in by GetMessageW.
                #[allow(unsafe_code)]
                unsafe {
                    DispatchMessageW(&raw const message);
                }
            }
        }
    }
    // Ends every registration and closes the queue before the window goes.
    HANDLER.take();
    // SAFETY: `window` was created on this thread and is destroyed only here.
    #[allow(unsafe_code)]
    unsafe {
        DestroyWindow(window);
    }
}

/// Register the window class once per process and create a message-only
/// window of it.
fn create_window() -> io::Result<HWND> {
    let class: Vec<u16> = CLASS.encode_utf16().chain([0]).collect();
    // SAFETY: a null name asks for the module that started the process, which
    // stays loaded for its lifetime.
    #[allow(unsafe_code)]
    let instance = unsafe { GetModuleHandleW(ptr::null()) };
    let info = WNDCLASSEXW {
        cbSize: CLASS_SIZE,
        lpfnWndProc: Some(window_proc),
        hInstance: instance,
        lpszClassName: class.as_ptr(),
        ..WNDCLASSEXW::default()
    };
    // SAFETY: `info` is a complete WNDCLASSEXW whose class name outlives the
    // call.
    #[allow(unsafe_code)]
    let class_atom = unsafe { RegisterClassExW(&raw const info) };
    if class_atom == 0 {
        let error = io::Error::last_os_error();
        // An earlier `RemovalNotices` registered it, with this same procedure.
        if error.raw_os_error() != i32::try_from(ERROR_CLASS_ALREADY_EXISTS).ok() {
            return Err(error);
        }
    }
    // SAFETY: the class is registered and its name outlives the call;
    // HWND_MESSAGE makes the window message-only.
    #[allow(unsafe_code)]
    let window = unsafe {
        CreateWindowExW(
            0,
            class.as_ptr(),
            ptr::null(),
            0,
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            ptr::null_mut(),
            instance,
            ptr::null(),
        )
    };
    if window.is_null() {
        Err(io::Error::last_os_error())
    } else {
        Ok(window)
    }
}

/// Open a root folder for its volume's notices. A folder opens only with
/// backup semantics; the default share mode leaves every other process free
/// to read, write and delete in it.
fn open_root(root: &Path) -> io::Result<File> {
    OpenOptions::new().read(true).custom_flags(FILE_FLAG_BACKUP_SEMANTICS).open(root)
}

/// A volume notice registration, ended on drop.
struct Notification(HDEVNOTIFY);

impl Drop for Notification {
    fn drop(&mut self) {
        // SAFETY: the handle came from RegisterDeviceNotificationW, and only
        // this drop unregisters it.
        #[allow(unsafe_code)]
        unsafe {
            UnregisterDeviceNotification(self.0);
        }
    }
}

/// Register `window` for the notices of the volume `handle` is open on; the
/// id is the one Windows names the registration with in those notices.
fn register(window: HWND, handle: &File) -> io::Result<(usize, Notification)> {
    let filter = DEV_BROADCAST_HANDLE {
        dbch_size: FILTER_SIZE,
        dbch_devicetype: DBT_DEVTYP_HANDLE,
        dbch_handle: handle.as_raw_handle(),
        ..DEV_BROADCAST_HANDLE::default()
    };
    // SAFETY: `window` is this thread's live window, and `filter` is a
    // DEV_BROADCAST_HANDLE that outlives the call, naming a handle `handle`
    // keeps open across it.
    #[allow(unsafe_code)]
    let notification = unsafe {
        RegisterDeviceNotificationW(window, (&raw const filter).cast(), DEVICE_NOTIFY_WINDOW_HANDLE)
    };
    if notification.is_null() {
        Err(io::Error::last_os_error())
    } else {
        Ok((notification.addr(), Notification(notification)))
    }
}

extern "system" fn window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let removal = if message == WM_DEVICECHANGE { notice(wparam) } else { None };
    if let Some(notice) = removal {
        // SAFETY: with a removal event Windows passes a DEV_BROADCAST_HDR
        // that starts a broadcast of `dbch_size` bytes living for the call.
        #[allow(unsafe_code)]
        let id = unsafe { registration(lparam) };
        if let Some(id) = id {
            with_handler(|handler| handler.notice(id, notice));
        }
        return GRANT;
    }
    #[cfg(test)]
    if message == IDS {
        // SAFETY: the tests send IDS, synchronously, with a pointer to a
        // vector they own.
        #[allow(unsafe_code)]
        let ids = unsafe { &mut *(lparam as *mut Vec<usize>) };
        with_handler(|handler| ids.extend(handler.ids()));
        return 0;
    }
    // SAFETY: passes on this procedure's own arguments, as a window procedure
    // must for the messages it does not handle.
    #[allow(unsafe_code)]
    let handled = unsafe { DefWindowProcW(window, message, wparam, lparam) };
    handled
}

/// The notice a `WM_DEVICECHANGE` event carries; `None` for the events the
/// window leaves alone.
fn notice(event: WPARAM) -> Option<Notice> {
    match u32::try_from(event).ok()? {
        DBT_DEVICEQUERYREMOVE => Some(Notice::QueryRemove),
        DBT_DEVICEQUERYREMOVEFAILED => Some(Notice::QueryRemoveFailed),
        DBT_DEVICEREMOVEPENDING | DBT_DEVICEREMOVECOMPLETE => Some(Notice::Removed),
        _ => None,
    }
}

/// The registration id a removal event names; `None` for an event about
/// anything but a handle.
///
/// # Safety
/// `lparam` is null or points at a `DEV_BROADCAST_HDR` that starts a
/// broadcast at least `dbch_size` bytes long, as Windows passes with a
/// removal event.
#[allow(unsafe_code)]
unsafe fn registration(lparam: LPARAM) -> Option<usize> {
    let header = lparam as *const DEV_BROADCAST_HDR;
    if header.is_null() {
        return None;
    }
    // SAFETY: the caller passes a DEV_BROADCAST_HDR.
    let header_fields = unsafe { *header };
    if header_fields.dbch_devicetype != DBT_DEVTYP_HANDLE
        || usize::try_from(header_fields.dbch_size).ok()? < NOTIFICATION_END
    {
        return None;
    }
    // SAFETY: a DBT_DEVTYP_HANDLE header starts a DEV_BROADCAST_HANDLE, and
    // its size covers `dbch_hdevnotify`, read without assuming the broadcast
    // is aligned for it.
    let notification = unsafe {
        header
            .byte_add(mem::offset_of!(DEV_BROADCAST_HANDLE, dbch_hdevnotify))
            .cast::<HDEVNOTIFY>()
            .read_unaligned()
    };
    Some(notification.addr())
}

/// The window thread's state, behind the window procedure and message loop.
trait Handle {
    fn notice(&mut self, id: usize, notice: Notice);
    fn follow(&mut self);
    /// The registration ids held now.
    #[cfg(test)]
    fn ids(&self) -> Vec<usize>;
}

thread_local! {
    /// Set while the thread's window exists.
    static HANDLER: RefCell<Option<Box<dyn Handle>>> = const { RefCell::new(None) };
}

/// Run `apply` on this thread's handler, if it has one. A nested call is
/// skipped rather than panicking, because a panic cannot unwind out of the
/// window procedure.
fn with_handler(apply: impl FnOnce(&mut dyn Handle)) {
    HANDLER.with(|handler| {
        if let Ok(mut handler) = handler.try_borrow_mut() {
            if let Some(handler) = handler.as_mut() {
                apply(handler.as_mut());
            }
        }
    });
}

struct Handler<K> {
    window: HWND,
    registrations: Registrations<K, Notification>,
    queued: mpsc::Receiver<HashMap<K, PathBuf>>,
    /// The roots last given, which a retry follows again.
    roots: HashMap<K, PathBuf>,
    removal: Box<dyn FnMut(&K, Removal) + Send>,
    /// The retry timer's period, in milliseconds.
    retry: u32,
    /// Whether the retry timer runs.
    retrying: bool,
}

impl<K: Clone + Eq + Hash> Handler<K> {
    /// Run the retry timer exactly while a root has no registration.
    fn retry_while_uncovered(&mut self) {
        let uncovered = !self.registrations.covers(&self.roots);
        if uncovered == self.retrying {
            return;
        }
        if uncovered {
            // SAFETY: `self.window` is this thread's live window. Without a
            // timer procedure the ticks arrive as WM_TIMER in its queue.
            #[allow(unsafe_code)]
            let set = unsafe { SetTimer(self.window, RETRY_TIMER, self.retry, None) };
            // A timer Windows refused is asked for again at the next change.
            self.retrying = set != 0;
        } else {
            // SAFETY: as above; the timer was set on this window.
            #[allow(unsafe_code)]
            unsafe {
                KillTimer(self.window, RETRY_TIMER);
            }
            self.retrying = false;
        }
    }
}

impl<K: Clone + Eq + Hash> Handle for Handler<K> {
    fn notice(&mut self, id: usize, notice: Notice) {
        if let Some((key, removal)) = self.registrations.notice(id, notice) {
            (self.removal)(&key, removal);
        }
        // A root not reopened after a refused removal is tried again.
        self.retry_while_uncovered();
    }

    fn follow(&mut self) {
        // Only the latest roots count; a retry tick follows the last ones
        // again.
        if let Some(roots) = self.queued.try_iter().last() {
            self.roots = roots;
        }
        let window = self.window;
        self.registrations.follow(&self.roots, |handle| register(window, handle));
        self.retry_while_uncovered();
    }

    #[cfg(test)]
    fn ids(&self) -> Vec<usize> {
        self.registrations.ids()
    }
}

/// The window, its registrations and their handles, driven by notices the
/// tests send as Windows sends them; only a real device removal is left out.
#[cfg(test)]
mod tests {
    use std::time::Instant;

    use windows_sys::Win32::UI::WindowsAndMessaging::SendMessageW;

    use super::*;

    /// Send `message` to the window and return the procedure's answer.
    fn send(window: usize, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        // SAFETY: the window lives while its test holds the notices, and
        // `lparam` points at data that outlives this synchronous call.
        #[allow(unsafe_code)]
        let answer =
            unsafe { SendMessageW(ptr::without_provenance_mut(window), message, wparam, lparam) };
        answer
    }

    /// The registration ids the window holds, once there are `count` of
    /// them or five seconds passed: the roots it registers arrive posted.
    fn registered(window: usize, count: usize) -> Vec<usize> {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let mut ids: Vec<usize> = Vec::new();
            send(window, IDS, 0, (&raw mut ids) as LPARAM);
            if ids.len() == count || Instant::now() > deadline {
                return ids;
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    /// A removal `event` about registration `id`, as Windows broadcasts it.
    fn notify(window: usize, event: u32, id: usize) -> LRESULT {
        let broadcast = DEV_BROADCAST_HANDLE {
            dbch_size: FILTER_SIZE,
            dbch_devicetype: DBT_DEVTYP_HANDLE,
            dbch_hdevnotify: ptr::without_provenance_mut(id),
            ..DEV_BROADCAST_HANDLE::default()
        };
        send(window, WM_DEVICECHANGE, event as WPARAM, (&raw const broadcast) as LPARAM)
    }

    /// Whether a handle is open on `root`: opening it with no sharing fails.
    fn held(root: &Path) -> bool {
        OpenOptions::new()
            .read(true)
            .share_mode(0)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
            .open(root)
            .is_err()
    }

    #[test]
    fn a_requested_removal_closes_the_root_before_it_is_granted() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let (reported, reports) = mpsc::channel();
        let notices = RemovalNotices::start(move |key: &&str, removal| {
            let _ = reported.send((*key, removal));
        })
        .unwrap();
        // A second window registers no class of its own.
        drop(RemovalNotices::<&str>::start(|_, _| {}).unwrap());
        let window = notices.roots.window;

        assert!(notices.roots().watch(HashMap::from([("card", root.clone())])));
        let [id] = registered(window, 1)[..] else { panic!("one registration") };
        assert!(held(&root), "the registration holds the root open");

        assert_eq!(notify(window, DBT_DEVICEQUERYREMOVE, id), GRANT);
        assert_eq!(reports.try_recv(), Ok(("card", Removal::Requested)));
        assert!(!held(&root), "closed before the removal was granted");

        assert_eq!(notify(window, DBT_DEVICEQUERYREMOVEFAILED, id), GRANT);
        assert_eq!(reports.try_recv(), Ok(("card", Removal::Refused)));
        assert!(held(&root), "open again once the removal was refused");

        assert_eq!(notify(window, DBT_DEVICEREMOVECOMPLETE, id), GRANT);
        assert_eq!(reports.try_recv(), Ok(("card", Removal::Removed)));
        assert_eq!(registered(window, 0), [] as [usize; 0]);
        assert!(!held(&root), "nothing holds a removed volume");
        // A notice for a registration that ended reaches nobody.
        assert_eq!(notify(window, DBT_DEVICEQUERYREMOVE, id), GRANT);
        assert!(reports.try_recv().is_err());
    }

    #[test]
    fn dropping_waits_for_a_callback_still_running() {
        let dir = tempfile::tempdir().unwrap();
        let (entered, entering) = mpsc::channel();
        let (finish, finishing) = mpsc::channel::<()>();
        let notices = RemovalNotices::start(move |_: &&str, _| {
            let _ = entered.send(());
            let _ = finishing.recv();
        })
        .unwrap();
        let window = notices.roots.window;
        assert!(notices.roots().watch(HashMap::from([("card", dir.path().to_path_buf())])));
        let [id] = registered(window, 1)[..] else { panic!("one registration") };

        let requested = thread::spawn(move || notify(window, DBT_DEVICEQUERYREMOVE, id));
        entering.recv_timeout(Duration::from_secs(5)).expect("the callback runs");
        let (dropped, done) = mpsc::channel();
        let dropping = thread::spawn(move || {
            drop(notices);
            let _ = dropped.send(());
        });
        assert!(done.recv_timeout(Duration::from_millis(300)).is_err(), "gone mid-callback");
        finish.send(()).unwrap();
        done.recv_timeout(Duration::from_secs(5)).expect("dropped once the callback returned");
        assert_eq!(requested.join().unwrap(), GRANT);
        dropping.join().unwrap();
    }

    /// A notice window whose unregistered roots are retried every 50 ms,
    /// reporting each removal on the returned channel.
    fn retrying() -> (RemovalNotices<&'static str>, mpsc::Receiver<(&'static str, Removal)>) {
        let (reported, reports) = mpsc::channel();
        let notices = RemovalNotices::start_with(Duration::from_millis(50), move |key, removal| {
            let _ = reported.send((*key, removal));
        })
        .unwrap();
        (notices, reports)
    }

    /// Nothing gives the window its roots again, yet a root that could not
    /// be opened registers at a retry tick once it can.
    #[test]
    fn a_root_that_could_not_be_opened_registers_at_a_retry() {
        let dir = tempfile::tempdir().unwrap();
        let (card, late) = (dir.path().join("card"), dir.path().join("late"));
        std::fs::create_dir(&card).unwrap();
        let (notices, _reports) = retrying();
        let window = notices.roots.window;

        assert!(notices.roots().watch(HashMap::from([("card", card), ("late", late.clone())])));
        // Both were followed: the one that opened is registered.
        assert_eq!(registered(window, 1).len(), 1);
        assert!(!late.exists(), "it cannot be opened yet");
        std::fs::create_dir(&late).unwrap();
        assert_eq!(registered(window, 2).len(), 2, "registered at a retry tick");
        assert!(held(&late), "its registration holds it open");
    }

    #[test]
    fn a_root_not_reopened_after_a_refused_removal_registers_at_a_retry() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("card");
        std::fs::create_dir(&root).unwrap();
        let (notices, reports) = retrying();
        let window = notices.roots.window;
        assert!(notices.roots().watch(HashMap::from([("card", root.clone())])));
        let [id] = registered(window, 1)[..] else { panic!("one registration") };

        // The root cannot be opened again when the removal is refused.
        assert_eq!(notify(window, DBT_DEVICEQUERYREMOVE, id), GRANT);
        std::fs::remove_dir(&root).unwrap();
        assert_eq!(notify(window, DBT_DEVICEQUERYREMOVEFAILED, id), GRANT);
        assert_eq!(reports.try_recv(), Ok(("card", Removal::Requested)));
        assert_eq!(reports.try_recv(), Ok(("card", Removal::Refused)));
        assert_eq!(registered(window, 0), [] as [usize; 0], "its registration ended");

        std::fs::create_dir(&root).unwrap();
        assert_eq!(registered(window, 1).len(), 1, "registered again at a retry tick");
        assert!(held(&root), "its registration holds it open");
    }
}
